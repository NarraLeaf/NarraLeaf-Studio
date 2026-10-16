/**
 * Page music: what the pages on screen do to the music.
 *
 * Built so that an author can predict it from the page inspector alone. Each page answers one of
 * three ways (`@shared/types/ui-editor/pageMusic`): it keeps whatever is playing, it plays a music
 * of its own, or it wants silence. The screen's music is the answer of the topmost page that says
 * something - a page that keeps is transparent to the decision.
 *
 * # How the screen's music follows navigation
 *
 * Every opened page is an instance (a navigation entry or a layer, with a key of its own), and the
 * music is decided per instance, from the top down:
 *
 *  1. **Set while open.** A graph on the page ran `Play Page Music` or `Stop Page Music` - a music
 *     room playing the row the player pressed, a title whose theme changes after the game is
 *     cleared. It overrides the page's own setting for as long as that instance is open, which is
 *     the rule every other runtime write follows: the inspector's value is the default, and a
 *     graph changes the field (see `editor-value-is-the-default`).
 *  2. **The page's own setting**, Play or Silence.
 *  3. **Carried over by Replace Page.** A page that keeps, opened by Replace, takes on the music of
 *     the page it replaced - what was playing goes on playing, which is what "keep" says. Without
 *     this, a Replace would leave a keeping page with nothing under it and stop the music.
 *  4. Otherwise the page keeps, and the instance beneath it decides.
 *
 * So a Settings page opened over the title lets the title's theme carry on; a music room with music
 * of its own (or whose rows set it) takes over, and Back hands the title its theme again - the
 * title's instance still says what it said. Nothing calling for music is silence.
 *
 * The same music (the same clip on the same track) is never started twice: two pages that both name
 * the title theme leave it playing, at the newer page's volume.
 *
 * # While a game holds the screen
 *
 * The story owns the music from the moment a game starts (or a save is loaded) until it ends. The
 * page's music leaves with its own fade as the press lands, and pages opened over the running game
 * play no page music: the scene's music goes on behind a menu as it always has. Returning to a page
 * - quitting, or a story that ends on one - gives the music back to the pages.
 *
 * # What plays it
 *
 * The host hands in a {@link PageMusicPlayer}; in the game that is `pageMusicPlayer.ts`, which plays
 * outside the engine's session so that a game starting, a session being swapped for the title, or a
 * Dev Mode hot reload neither cuts the music off mid-fade nor starts it again from the top.
 *
 * Comments in English per project convention.
 */

import type { UISurface } from "@shared/types/ui-editor/document";
import { readUIPageMusicChoice, type UIPageMusic } from "@shared/types/ui-editor/pageMusic";
import { resolveAssetVariantMember, type AssetVariantMap } from "@shared/types/assetSet";
import {
    BUILTIN_AUDIO_TRACKS,
    resolveAudioTrack,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";

/** The music called for, resolved down to what is played. */
export type PageMusicCue = {
    /**
     * What makes two cues the same music: the clip and the bus it plays on. Two pages naming the same
     * theme on the same track share one playing sound; anything else is a hand-over.
     */
    key: string;
    /** The page whose music this is. */
    surfaceId: string;
    /** The clip, an asset set already resolved to the member for the game's language. */
    assetId: string;
    /** The track it plays on, resolved: a missing or deleted track lands on Music. */
    audioTrackId: string;
    /** 0..1. */
    volume: number;
    /** Absent: the track's own loop default. */
    loop?: boolean;
    /** The fade it comes in with, and goes out with when it hands over. */
    fadeMs: number;
};

/** What one opened page says about the music. Keep is the absence of a decision. */
export type PageMusicDecision =
    | { kind: "play"; cue: PageMusicCue }
    /** `leaveFadeMs`: how the music playing leaves; absent, it leaves with its own fade. */
    | { kind: "silence"; leaveFadeMs?: number };

/** What the screen calls for. */
export type PageMusicTarget = {
    /** The music to play, or null for none. */
    cue: PageMusicCue | null;
    /** How the music playing now leaves, when the screen says so (Stop Page Music's fade). */
    leaveFadeMs?: number;
};

/** One opened page, as the decision sees it. */
export type PageMusicScreenEntry = {
    /** The instance: a navigation entry's key, or a layer's. */
    key: string;
    /** Absent when the bundle no longer has the page; it then says nothing. */
    surface: UISurface | null | undefined;
};

type CueContext = {
    tracks?: readonly ProjectAudioTrack[];
    locale?: string | null;
    sourceLocale?: string;
};

/**
 * A music record as the cue that plays it: the asset set resolved for the game's language (from the
 * answers the build wrote beside it), the track resolved with a deleted one landing on Music, the
 * volume clamped where the engine clamps.
 */
export function pageMusicCueOf(
    music: UIPageMusic,
    owner: { surfaceId: string; assetVariants?: AssetVariantMap },
    context: CueContext,
): PageMusicCue {
    const tracks = context.tracks && context.tracks.length > 0 ? context.tracks : BUILTIN_AUDIO_TRACKS;
    const assetId = resolveAssetVariantMember(
        owner.assetVariants,
        music.assetId,
        context.locale ?? undefined,
        context.sourceLocale,
    ) ?? music.assetId;
    const audioTrackId = resolveAudioTrack(tracks, music.audioTrackId, "bgm").id;
    return {
        key: `${assetId}\u0000${audioTrackId}`,
        surfaceId: owner.surfaceId,
        assetId,
        audioTrackId,
        volume: Math.min(1, Math.max(0, music.volume ?? 1)),
        ...(music.loop !== undefined ? { loop: music.loop } : {}),
        fadeMs: Math.max(0, music.fadeMs ?? 0),
    };
}

/** What a page's own setting says, or null when it keeps. A Game UI keeps. */
function ownDecision(surface: UISurface | null | undefined, context: CueContext): PageMusicDecision | null {
    if (!surface) {
        return null;
    }
    const choice = readUIPageMusicChoice(surface);
    if (choice.kind === "play") {
        return {
            kind: "play",
            cue: pageMusicCueOf(choice.music, { surfaceId: surface.id, assetVariants: surface.settings?.assetVariants }, context),
        };
    }
    return choice.kind === "silence" ? { kind: "silence" } : null;
}

/**
 * The decision of the topmost page that makes one, or null when every page keeps.
 *
 * `entries` is top first: the layers shown over the page stack (topmost first), then the page stack
 * (topmost first). Also how a Replace Page reads what the replaced page had playing - asked of the
 * stack from that page down.
 */
export function pageMusicDecisionFor(input: CueContext & {
    entries: readonly PageMusicScreenEntry[];
    /** Set while open by a graph on the page (Play / Stop Page Music), by instance key. */
    setWhileOpen?: ReadonlyMap<string, PageMusicDecision>;
    /** Carried over by Replace Page, by instance key; read only for a page that keeps. */
    carriedOver?: ReadonlyMap<string, PageMusicDecision>;
}): PageMusicDecision | null {
    for (const entry of input.entries) {
        const decision = input.setWhileOpen?.get(entry.key)
            ?? ownDecision(entry.surface, input)
            ?? input.carriedOver?.get(entry.key);
        if (decision) {
            return decision;
        }
    }
    return null;
}

/** What the screen calls for; see the module header for the order pages are asked in. */
export function pageMusicFor(input: Parameters<typeof pageMusicDecisionFor>[0]): PageMusicTarget {
    const decision = pageMusicDecisionFor(input);
    if (!decision) {
        return { cue: null };
    }
    if (decision.kind === "play") {
        return { cue: decision.cue };
    }
    return decision.leaveFadeMs !== undefined ? { cue: null, leaveFadeMs: decision.leaveFadeMs } : { cue: null };
}

/** How a host plays page music. `handle` is whatever its player hands back for one playing clip. */
export type PageMusicPlayer<THandle> = {
    /** Start a cue, fading in over its `fadeMs`. Null when nothing could be played. */
    play: (cue: PageMusicCue) => Promise<THandle | null>;
    stop: (handle: THandle, fadeMs: number) => void;
    setVolume: (handle: THandle, volume: number, fadeMs: number) => void;
    /** True while a game holds the screen, or is about to; see the module header. */
    isHeld: () => boolean;
};

export type PageMusicController = {
    /** What the pages on screen now call for. */
    update: (target: PageMusicTarget) => void;
    /** Ask again with the same pages, after something {@link PageMusicPlayer.isHeld} reads changed. */
    refresh: () => void;
    /** Stop at once and forget everything; the host is going away. */
    dispose: () => void;
};

type Playing<THandle> = {
    cue: PageMusicCue;
    handle: THandle | null;
    settled: boolean;
};

/**
 * One piece of page music at a time, handed over as the screen changes.
 *
 * A play is asynchronous - the clip has to be found and loaded - so a request is held as "starting"
 * until it settles, and one that settles after the screen has moved on, or after a game has taken
 * the screen, is stopped there and then rather than left playing over what came next.
 */
export function createPageMusicController<THandle>(player: PageMusicPlayer<THandle>): PageMusicController {
    let wanted: PageMusicTarget = { cue: null };
    let current: Playing<THandle> | null = null;

    const start = (cue: PageMusicCue): void => {
        const entry: Playing<THandle> = { cue, handle: null, settled: false };
        current = entry;
        void player.play(cue).then(
            handle => {
                if (current !== entry || player.isHeld()) {
                    if (handle !== null) {
                        player.stop(handle, 0);
                    }
                    if (current === entry) {
                        current = null;
                    }
                    return;
                }
                entry.handle = handle;
                entry.settled = true;
            },
            () => {
                if (current === entry) {
                    entry.settled = true;
                }
            },
        );
    };

    const reconcile = (): void => {
        const held = player.isHeld();
        const target = held ? null : wanted.cue;

        // A request that settled with nothing to play is asked again: the clip may have been missing
        // a moment ago and be there now (an author fixing the page under a running Dev Mode).
        if (current?.settled && current.handle === null) {
            current = null;
        }

        if (current && target && current.cue.key === target.key) {
            if (current.settled && current.handle !== null && current.cue.volume !== target.volume) {
                player.setVolume(current.handle, target.volume, target.fadeMs);
            }
            // The newer page's fade is the one the music leaves with.
            current.cue = target;
            return;
        }

        if (current) {
            // A request still starting is stopped where it settles; see `start`.
            if (current.settled && current.handle !== null) {
                // A game taking the screen takes the music the way the page would have handed it over.
                const fadeMs = !held && wanted.leaveFadeMs !== undefined ? wanted.leaveFadeMs : current.cue.fadeMs;
                player.stop(current.handle, fadeMs);
            }
            current = null;
        }
        if (target) {
            start(target);
        }
    };

    return {
        update: target => {
            wanted = target;
            reconcile();
        },
        refresh: reconcile,
        dispose: () => {
            wanted = { cue: null };
            if (current?.settled && current.handle !== null) {
                player.stop(current.handle, 0);
            }
            current = null;
        },
    };
}
