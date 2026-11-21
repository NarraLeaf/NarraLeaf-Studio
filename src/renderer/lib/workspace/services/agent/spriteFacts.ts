/**
 * What a sprite measures: the project's stage and a character's default look, in pixels.
 *
 * The cast tools report these to an agent, and the character editor reads the same numbers when a
 * character's first art arrives and she is given a standing default. They live apart from the tools
 * so the editor can read them without importing the agent's tool layer - which reaches the agent
 * core and, through it, the built-in widget modules, closing an import cycle the editor sits on.
 *
 * Comments in English per project convention.
 */

import { AssetType } from "../assets/assetTypes";
import type { Asset, AssetSource } from "../assets/types";
import { Services, type WorkspaceContext } from "../services";
import type { ProjectService } from "../core/ProjectService";
import type { Character } from "../character/Character";
import { isPuppetAppearance } from "../character/types";
import { assetsService } from "./agentLookups";
import { readImageAlpha, type ImageAlphaFacts } from "./imageAlpha";
import { opaqueBounds, stageSizeOf, type EntranceMatch, type PixelSize, type SpriteMeasure } from "./spriteStage";
import type { CharacterService } from "../core/CharacterService";
import type { PortraitCrop } from "../character/types";
import { HEAD_FRAME_PADDING } from "../character/headDetection";

/** The project's design resolution: the stage every sprite position is a share of. */
export function stageSize(ctx: WorkspaceContext): PixelSize {
    return stageSizeOf(ctx.services.get<ProjectService>(Services.Project).getProjectConfig().metadata?.resolution);
}

export type ImageFacts = { name: string; size: PixelSize | null; header: ImageAlphaFacts };

/**
 * An image asset's pixel size and whether it can be transparent, from its bytes. Null when the asset
 * is gone or will not read - a pose that cannot be measured is reported without a box, never refused.
 */
export async function readImageFacts(ctx: WorkspaceContext, assetId: string): Promise<ImageFacts | null> {
    const assets = assetsService(ctx);
    const asset = assets.getAssets()[AssetType.Image]?.[assetId] as Asset<AssetType, AssetSource> | undefined;
    if (!asset) {
        return null;
    }
    const fetched = await assets.fetch(asset).catch(() => null);
    const data = fetched && fetched.success ? (fetched.data as { data?: unknown; metadata?: { width?: number; height?: number } } | undefined) : undefined;
    if (!data || !(data.data instanceof Uint8Array)) {
        return null;
    }
    const facts = readImageAlpha(data.data);
    const width = data.metadata?.width || facts.width;
    const height = data.metadata?.height || facts.height;
    return { name: asset.name, size: width && height ? { width, height } : null, header: facts };
}

/**
 * The default look's pixel size: a preset's default pose, a layered character's canvas (every layer
 * is drawn at it), a puppet's stage box when one is set. Null when it cannot be known.
 */
export async function defaultSpriteSize(ctx: WorkspaceContext, character: Character): Promise<PixelSize | null> {
    const appearance = character.profile.appearance;
    const stored = appearance.toJSON();
    if (stored.kind === "layered") {
        return stored.canvas ? { ...stored.canvas } : null;
    }
    if (isPuppetAppearance(stored)) {
        return stored.size ? { ...stored.size } : null;
    }
    const assetId = appearance.resolvePoseAssetId(undefined);
    return assetId ? (await readImageFacts(ctx, assetId))?.size ?? null : null;
}

/** Longest edge the silhouette is read at: a share of a few hundred rows is plenty for a framing. */
const MEASURE_PX = 512;

/** Finds the head in a stack of layers; `headDetector.detectHeadFrame`, loaded only when asked for. */
export type SpriteHeadDetector = (layers: readonly ImageBitmap[]) => Promise<PortraitCrop | null>;

async function decodeImage(ctx: WorkspaceContext, assetId: string): Promise<ImageBitmap | null> {
    const assets = assetsService(ctx);
    const asset = assets.getAssets()[AssetType.Image]?.[assetId] as Asset<AssetType, AssetSource> | undefined;
    if (!asset) return null;
    const fetched = await assets.fetch(asset).catch(() => null);
    const data = fetched && fetched.success ? (fetched.data as { data?: unknown } | undefined) : undefined;
    if (!data || !(data.data instanceof Uint8Array)) return null;
    return createImageBitmap(new Blob([new Uint8Array(data.data)])).catch(() => null);
}

/**
 * Where the figure sits in a character's default look (`SpriteMeasure`), or null when there is no
 * picture to read: a puppet, a look with no art, a file that will not decode.
 *
 * The layers are drawn centred on one another - the rule the engine composites by - at
 * {@link MEASURE_PX} on the longest edge, and the silhouette is read off their alpha. `detectHead`
 * adds the head; it loads a model, so only a request an author or an agent made passes one.
 */
export async function measureCharacterSprite(
    ctx: WorkspaceContext,
    character: Character,
    detectHead?: SpriteHeadDetector,
): Promise<SpriteMeasure | null> {
    const stored = character.profile.appearance.toJSON();
    // No decoder outside a window (the tools' tests run in node): unmeasured, the size guesses.
    if (isPuppetAppearance(stored) || typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
        return null;
    }
    const layerIds = character.profile.appearance.resolveDrawList({}).filter((id): id is string => Boolean(id));
    if (layerIds.length === 0) {
        return null;
    }
    const decoded = await Promise.all(layerIds.map(id => decodeImage(ctx, id)));
    const layers = decoded.filter((bitmap): bitmap is ImageBitmap => bitmap !== null);
    try {
        if (layers.length === 0) {
            return null;
        }
        const width = Math.max(...layers.map(layer => layer.width));
        const height = Math.max(...layers.map(layer => layer.height));
        const scale = Math.min(1, MEASURE_PX / Math.max(width, height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return null;
        }
        for (const layer of layers) {
            context.drawImage(
                layer,
                ((width - layer.width) / 2) * scale,
                ((height - layer.height) / 2) * scale,
                layer.width * scale,
                layer.height * scale,
            );
        }
        const bounds = opaqueBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (!bounds) {
            return null;
        }
        const crop = detectHead ? await detectHead(layers).catch(() => null) : null;
        if (!crop) {
            return bounds;
        }
        // The detector answers with an avatar framing: a square on the head box's longer side, padded.
        // Its height unpadded is the head's height, near enough for counting heads.
        const headHeight = crop.h / HEAD_FRAME_PADDING;
        return { ...bounds, head: { top: crop.y + (crop.h - headHeight) / 2, height: headHeight } };
    } finally {
        layers.forEach(layer => layer.close());
    }
}

/**
 * Cast members whose default look is the same size as `sprite` and who state entrance defaults - art
 * exported at one size was drawn to one scale, so their zoom and baseline fit this character too and
 * keep the difference in heights. In cast order, one per distinct set of defaults.
 */
export async function castEntranceMatches(ctx: WorkspaceContext, character: Character, sprite: PixelSize | null): Promise<EntranceMatch[]> {
    if (!sprite) {
        return [];
    }
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const matches: EntranceMatch[] = [];
    const seen = new Set<string>();
    for (const other of cast.listCharacter()) {
        const props = other.profile.getEntranceTransform();
        if (other.profile.getId() === character.profile.getId() || props === undefined) {
            continue;
        }
        const size = await defaultSpriteSize(ctx, other).catch(() => null);
        if (!size || size.width !== sprite.width || size.height !== sprite.height) {
            continue;
        }
        const key = JSON.stringify(props);
        if (!seen.has(key)) {
            seen.add(key);
            matches.push({ name: other.profile.getName(), props });
        }
    }
    return matches;
}
