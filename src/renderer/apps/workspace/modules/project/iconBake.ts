import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import { halvingSteps, planIconDraw } from "@shared/utils/iconRecipe";
import { encodeOpaquePng } from "@shared/utils/pngOpaque";
import {
    PROJECT_ICON_OUTPUTS,
    projectIconFingerprint,
    resolveIconSource,
    type ProjectIconOutput,
    type ProjectIconOutputId,
    type ProjectIconSet,
} from "@shared/types/projectIcons";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { extractIconPixels } from "./iconPreview";

/**
 * Baking the author's master into one PNG per build target.
 *
 * This runs at authoring time rather than at build time because the baked files
 * are project content: they travel in the .nlspkg and belong in version control,
 * so a teammate who pulls the project gets the icons without re-deriving them.
 *
 * Which makes byte-stability the whole game. Nothing here writes unless the
 * bytes actually differ (see ProjectService.writeProjectIconBake), and nothing
 * re-renders unless the recipe fingerprint moved - otherwise every project open
 * would show up as a change nobody made.
 */

/** The subset of ProjectService this module needs, named so it can be faked. */
export interface IconBakeIO {
    readProjectIconFile(relativePath: string): Promise<Uint8Array | null>;
    projectIconFileExists(relativePath: string): Promise<boolean>;
    writeProjectIconBake(relativePath: string, bytes: Uint8Array): Promise<boolean>;
    deleteProjectIconFile(relativePath: string): Promise<void>;
}

export type IconBakeReport = {
    set: ProjectIconSet;
    /** Outputs whose bytes changed on disk. Empty means the project was current. */
    written: ProjectIconOutputId[];
    /** Outputs whose source is configured but unreadable. */
    unreadable: ProjectIconOutputId[];
};

/**
 * Bring every baked output in line with the set, and return the set to persist.
 * Safe to call on every panel open: an up-to-date project performs reads only.
 */
export async function bakeProjectIcons(io: IconBakeIO, set: ProjectIconSet): Promise<IconBakeReport> {
    const baked: ProjectIconSet["baked"] = { ...set.baked };
    const written: ProjectIconOutputId[] = [];
    const unreadable: ProjectIconOutputId[] = [];
    // One decode per distinct source, not per output: web alone asks for two.
    const decoded = new Map<string, DecodedIcon | null>();

    for (const output of PROJECT_ICON_OUTPUTS) {
        const spec = set.specs[output.target];
        const source = resolveIconSource(set, output.target);
        const relativePath = ProjectNameConvention.ProjectIconDerivedFile(output.fileName).join("/");

        if (!source) {
            if (baked[output.id]) {
                await io.deleteProjectIconFile(baked[output.id]!.path);
                delete baked[output.id];
            }
            continue;
        }

        const bytes = await io.readProjectIconFile(source.path);
        if (!bytes) {
            unreadable.push(output.id);
            continue;
        }

        const fingerprint = projectIconFingerprint({ sourceHash: fnv1a64BytesHex(bytes), spec, output });
        const current = baked[output.id];
        if (current?.fingerprint === fingerprint && current.path === relativePath
            && await io.projectIconFileExists(relativePath)) {
            continue;
        }

        if (!decoded.has(source.path)) {
            decoded.set(source.path, await decodeIcon(bytes, source.mediaType, source.path).catch(() => null));
        }
        const image = decoded.get(source.path);
        if (!image) {
            unreadable.push(output.id);
            continue;
        }

        const png = await renderIconOutput(image, spec, output);
        if (await io.writeProjectIconBake(relativePath, png)) {
            written.push(output.id);
        }
        baked[output.id] = { path: relativePath, fingerprint };
    }

    for (const image of decoded.values()) {
        image?.release();
    }

    return { set: { ...set, baked }, written, unreadable };
}

type DecodedIcon = {
    element: HTMLImageElement;
    width: number;
    height: number;
    release(): void;
};

/**
 * Decode a source into something drawable. Uses an <img> rather than
 * createImageBitmap because the latter refuses SVG, and .icns is unpacked to
 * its largest embedded PNG first - browsers cannot read the container.
 */
export async function decodeIcon(bytes: Uint8Array, mediaType: string, path: string): Promise<DecodedIcon> {
    const pixels = extractIconPixels(bytes, mediaType, path);
    const blob = new Blob([toArrayBuffer(pixels.bytes)], { type: pixels.mediaType });
    const url = URL.createObjectURL(blob);
    const element = new Image();
    try {
        await new Promise<void>((resolve, reject) => {
            element.onload = () => resolve();
            element.onerror = () => reject(new Error(`Could not decode icon: ${path}`));
            element.src = url;
        });
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
    return {
        element,
        // An SVG with no intrinsic size reports 0; the draw plan reads that as
        // square and fills the canvas, which is the right answer for vector art.
        width: element.naturalWidth,
        height: element.naturalHeight,
        release: () => URL.revokeObjectURL(url),
    };
}

/** Render one output's PNG bytes from a decoded source. */
export async function renderIconOutput(
    image: DecodedIcon,
    spec: ProjectIconSet["specs"][keyof ProjectIconSet["specs"]],
    output: ProjectIconOutput,
): Promise<Uint8Array> {
    const plan = planIconDraw({
        sourceWidth: image.width,
        sourceHeight: image.height,
        spec,
        output,
    });

    const canvas = createCanvas(plan.canvas, plan.canvas);
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Could not acquire a 2D context to bake the icon");
    }

    if (plan.background) {
        context.fillStyle = plan.background;
        context.fillRect(0, 0, plan.canvas, plan.canvas);
    }

    const artwork = downscaleInHalves(image, Math.max(plan.width, plan.height));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(artwork, plan.x, plan.y, plan.width, plan.height);

    // An output that forbids alpha must not merely be opaque - it must carry no
    // alpha channel at all. Apple's asset validator rejects an icon that has
    // one even when every pixel is fully opaque, and canvas.toBlob always
    // encodes RGBA, so these are re-encoded as PNG truecolour.
    if (!output.opaque) {
        return canvasToPngBytes(canvas);
    }
    const pixels = context.getImageData(0, 0, plan.canvas, plan.canvas);
    return encodeOpaquePng(new Uint8Array(pixels.data.buffer), pixels.width, pixels.height, deflate);
}

/**
 * Step a source down to roughly `targetEdge` by repeated halving. A single
 * bilinear step from 1024 to a 32px favicon samples so few of the source's
 * pixels that thin strokes disappear entirely.
 */
function downscaleInHalves(image: DecodedIcon, targetEdge: number): CanvasImageSource {
    const sourceEdge = Math.max(image.width, image.height);
    if (sourceEdge <= 0) {
        return image.element;
    }
    const steps = halvingSteps(sourceEdge, targetEdge);
    if (steps.length === 0) {
        return image.element;
    }

    const aspect = image.height > 0 ? image.width / image.height : 1;
    let current: CanvasImageSource = image.element;
    for (const edge of steps) {
        const width = aspect >= 1 ? edge : Math.max(1, Math.round(edge * aspect));
        const height = aspect >= 1 ? Math.max(1, Math.round(edge / aspect)) : edge;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) {
            return current;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(current, 0, 0, width, height);
        current = canvas;
    }
    return current;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
        throw new Error("Could not encode the baked icon as PNG");
    }
    return new Uint8Array(await blob.arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

/** zlib-wrapped deflate, which is the framing PNG's IDAT expects. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
