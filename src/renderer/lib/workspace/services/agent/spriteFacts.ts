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
import { stageSizeOf, type PixelSize } from "./spriteStage";

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
