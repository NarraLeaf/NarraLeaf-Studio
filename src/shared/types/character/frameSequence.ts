/** Ordered PNG assets, sampled against a character instance's playback time. */
export interface CharacterFrameSequence {
    frameAssetIds: string[];
    fps: number;
    loop: boolean;
}

export function normalizeFrameSequence(value: unknown): CharacterFrameSequence | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Partial<CharacterFrameSequence>;
    if (
        !Array.isArray(raw.frameAssetIds) ||
        raw.frameAssetIds.length === 0 ||
        raw.frameAssetIds.some(id => typeof id !== "string" || !id.trim())
    )
        return undefined;
    if (typeof raw.fps !== "number" || !Number.isFinite(raw.fps) || raw.fps <= 0 || raw.fps > 120) return undefined;
    return { frameAssetIds: [...raw.frameAssetIds], fps: raw.fps, loop: raw.loop !== false };
}
