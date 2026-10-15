/**
 * The music a page plays while it is the page on screen - the page's counterpart of a scene's music
 * (`StorySceneBgm`), with the same five fields and the same defaults.
 *
 * Stored on the page's own settings (`UISurfaceSettings.music`) and read only for pages: a Game UI is
 * drawn over a running scene, and the scene's music is what plays there.
 *
 * `assetId` is spelled the way every other asset slot in the interface document is, so a build, the
 * shipped game's preloader, the asset set pass and the content audit all find it without being told
 * about it (`@shared/build/uiAssetSlots`). An asset set is allowed here exactly as on a scene: the
 * build writes the answer onto the page's settings (`UISurfaceSettings.assetVariants`).
 *
 * Comments in English per project convention.
 */
export type UIPageMusic = {
    /** Audio library asset id, or an audio asset set's id. Absent music is an absent field. */
    assetId: string;
    /** The project audio track it plays on (`ProjectAudioTrack.id`). Absent = the Music track. */
    audioTrackId?: string;
    /** 0-1 as authored. Absent = 1. */
    volume?: number;
    /** Absent = the track's own loop default (Music loops). */
    loop?: boolean;
    /** Fade-in as the page brings it in, and fade-out as it hands over, in milliseconds. Absent = 0. */
    fadeMs?: number;
};

/**
 * Read a stored page music record, or `null` when there is nothing to play.
 *
 * An entry with no asset id is no music rather than broken music: clearing the picker removes the
 * whole field, so only a document written by something other than the inspector can hold options
 * with no clip, and silence is the honest reading of it. Out-of-range numbers are dropped to their
 * defaults rather than clamped here; the player clamps where the engine does.
 */
export function normalizeUIPageMusic(value: unknown): UIPageMusic | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
    if (!assetId) {
        return null;
    }
    const audioTrackId = typeof record.audioTrackId === "string" ? record.audioTrackId.trim() : "";
    const volume = finite(record.volume);
    const fadeMs = finite(record.fadeMs);
    return {
        assetId,
        ...(audioTrackId ? { audioTrackId } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(typeof record.loop === "boolean" ? { loop: record.loop } : {}),
        ...(fadeMs !== undefined && fadeMs >= 0 ? { fadeMs } : {}),
    };
}

/** A page's music, read off its settings. A Game UI has none, whatever its settings hold. */
export function readUIPageMusic(
    surface: { kind: string; settings?: { music?: unknown } } | null | undefined,
): UIPageMusic | null {
    if (!surface || surface.kind !== "appSurface") {
        return null;
    }
    return normalizeUIPageMusic(surface.settings?.music);
}

function finite(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
