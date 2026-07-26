import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import { halvingSteps, planIconDraw } from "@shared/utils/iconRecipe";
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
    return output.opaque
        ? encodeOpaquePng(context.getImageData(0, 0, plan.canvas, plan.canvas))
        : canvasToPngBytes(canvas);
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

/**
 * Encode RGBA image data as a PNG with no alpha channel (colour type 2).
 *
 * Hand-rolled because the platform gives no way to ask canvas for one: toBlob
 * emits colour type 6 whatever the pixels say. Every row uses the Paeth filter
 * - one fixed choice rather than a heuristic, so the same pixels always produce
 * the same bytes, which is what keeps these files quiet in version control.
 */
async function encodeOpaquePng(image: ImageData): Promise<Uint8Array> {
    const { width, height, data } = image;
    const stride = width * 3;
    const raw = new Uint8Array((stride + 1) * height);
    const current = new Uint8Array(stride);
    const previous = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = (y * width + x) * 4;
            const target = x * 3;
            current[target] = data[source];
            current[target + 1] = data[source + 1];
            current[target + 2] = data[source + 2];
        }
        const rowStart = y * (stride + 1);
        raw[rowStart] = 4;
        for (let i = 0; i < stride; i++) {
            const left = i >= 3 ? current[i - 3] : 0;
            const up = previous[i];
            const upLeft = i >= 3 ? previous[i - 3] : 0;
            raw[rowStart + 1 + i] = (current[i] - paethPredictor(left, up, upLeft)) & 0xff;
        }
        previous.set(current);
    }

    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, width);
    new DataView(header.buffer).setUint32(4, height);
    header[8] = 8;  // bit depth
    header[9] = 2;  // colour type: truecolour, no alpha
    return concatBytes([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", await deflate(raw)),
        pngChunk("IEND", new Uint8Array(0)),
    ]);
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** zlib-wrapped deflate, which is the framing PNG's IDAT expects. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) {
        body[i] = type.charCodeAt(i);
    }
    body.set(data, 4);
    const chunk = new Uint8Array(8 + data.length + 4);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(body, 4);
    view.setUint32(chunk.length - 4, crc32(body));
    return chunk;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
