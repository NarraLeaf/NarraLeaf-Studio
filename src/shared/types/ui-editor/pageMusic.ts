/**
 * What a page does to the music while it is the page on screen.
 *
 * Three answers, each one a choice an author can see and pick in the page inspector:
 *
 *  - **Keep** (no field at all): the page leaves the music alone. Whatever was playing when it
 *    opened goes on playing - a Settings page opened from the title does not interrupt the title's
 *    theme, and neither does a Replace Page that swaps one menu for another.
 *  - **Play** ({@link UIPageMusic}): the page plays this music. The same music already playing
 *    carries on uninterrupted; anything else hands over to it.
 *  - **Silence** ({@link UIPageSilence}): the page wants no music - an OP movie, a voice test.
 *
 * Keep is the absent field rather than a stored value because it is what every page did before
 * pages had music, and what a page an author never touched should go on doing. The inspector still
 * names it, so the empty state is never a blank the author has to interpret.
 *
 * The page's counterpart of a scene's music (`StorySceneBgm`): a played record has the same five
 * fields with the same defaults. Stored on the page's own settings (`UISurfaceSettings.music`) and
 * read only for pages: a Game UI is drawn over a running scene, and the scene's music is what plays
 * there.
 *
 * `assetId` is spelled the way every other asset slot in the interface document is, so a build, the
 * shipped game's preloader, the asset set pass and the content audit all find it without being told
 * about it (`@shared/build/uiAssetSlots`). An asset set is allowed here exactly as on a scene: the
 * build writes the answer onto the page's settings (`UISurfaceSettings.assetVariants`). A silent
 * page names no asset, so none of those passes has anything to find on it.
 *
 * Comments in English per project convention.
 */
export type UIPageMusic = {
    /** Audio library asset id, or an audio asset set's id. */
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

/** A page that wants no music while it is on screen. The music playing leaves with its own fade. */
export type UIPageSilence = {
    silent: true;
};

/** What `UISurfaceSettings.music` may hold. Absent means Keep. */
export type UIPageMusicSetting = UIPageMusic | UIPageSilence;

/** A page's music setting, read: the three answers as one value to switch on. */
export type UIPageMusicChoice =
    | { kind: "keep" }
    | { kind: "play"; music: UIPageMusic }
    | { kind: "silence" };

/**
 * Read a stored page music record as music to play, or `null` when it plays nothing.
 *
 * An entry with no asset id is no music rather than broken music: clearing the picker removes the
 * whole field, so only a document written by something other than the inspector can hold options
 * with no clip. Out-of-range numbers are dropped to their defaults rather than clamped here; the
 * player clamps where the engine does.
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

/**
 * Read a stored page music setting as one of its three answers.
 *
 * A clip wins over a silence flag written beside it: the inspector never writes both, and a record
 * that names music is the one an author can see something of. Anything that is neither reads as
 * Keep, the answer that changes nothing.
 */
export function normalizeUIPageMusicChoice(value: unknown): UIPageMusicChoice {
    const music = normalizeUIPageMusic(value);
    if (music) {
        return { kind: "play", music };
    }
    if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).silent === true) {
        return { kind: "silence" };
    }
    return { kind: "keep" };
}

/** A page's music choice, read off its settings. A Game UI keeps the music, whatever its settings hold. */
export function readUIPageMusicChoice(
    surface: { kind: string; settings?: { music?: unknown } } | null | undefined,
): UIPageMusicChoice {
    if (!surface || surface.kind !== "appSurface") {
        return { kind: "keep" };
    }
    return normalizeUIPageMusicChoice(surface.settings?.music);
}

/** The music a page plays, read off its settings, or `null` when it plays none (Keep or Silence). */
export function readUIPageMusic(
    surface: { kind: string; settings?: { music?: unknown } } | null | undefined,
): UIPageMusic | null {
    const choice = readUIPageMusicChoice(surface);
    return choice.kind === "play" ? choice.music : null;
}

function finite(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
