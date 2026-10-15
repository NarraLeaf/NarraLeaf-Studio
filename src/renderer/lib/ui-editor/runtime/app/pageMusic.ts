/**
 * Page music: the music a page plays while it is the page on screen.
 *
 * The page's counterpart of a scene's music, and built to the same rule - the music belongs to what
 * the player is looking at. A scene's music starts as the scene starts and stops as it ends; a
 * page's starts as the page is entered and stops as the page is left, cross-fading with the music
 * that takes over exactly as one scene's music hands over to the next.
 *
 * # Which music the screen calls for
 *
 * The page on top decides, and a page with no music of its own lets the music under it go on:
 *
 *  - **A page opened over another** - Go Page, or a layer shown over it - plays its own music if it
 *    has some, and otherwise the music of the page beneath keeps playing, uninterrupted. A title's
 *    music therefore carries on through a Settings page opened from it, and comes back in when a
 *    music room with a track of its own is closed.
 *  - **A page that leaves** - Back, Close, Replace Page, a quit collapsing the stack - takes its
 *    music with it, and the music of whatever is now on top comes in.
 *  - **The same music** (the same clip on the same track) is never started twice: two pages that
 *    both name the title theme leave it playing, at the newer page's volume.
 *
 * # While a game holds the screen
 *
 * The story owns the music from the moment a game starts until it ends. Starting a game from the
 * title stops the title's music, and the first scene's own music takes over; pages opened over the
 * running game (a menu, Settings, a confirm) play no page music, so the game's music goes on behind
 * them as it does today. Returning to the title - quitting, or a story that ends on a page - gives
 * the music back to the pages, and the title's music starts again.
 *
 * The engine is also why this is the only answer that holds: starting a game resets the engine's
 * audio, which stops every sound it is playing, and nothing a host plays is restored from a save.
 *
 * # What plays it
 *
 * The host hands in a {@link PageMusicPlayer} - in the game, a sound transport of its own, so a
 * graph's Stop Sound with no handle (which stops every sound a blueprint started) leaves the page's
 * music alone, the way it leaves a scene's.
 *
 * Comments in English per project convention.
 */

import type { UISurface } from "@shared/types/ui-editor/document";
import { readUIPageMusic } from "@shared/types/ui-editor/pageMusic";
import { resolveAssetVariantMember } from "@shared/types/assetSet";
import {
    BUILTIN_AUDIO_TRACKS,
    resolveAudioTrack,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";

/** The music the screen calls for, resolved down to what is played. */
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

/**
 * The music called for by the pages on screen, given top first: the layers shown over the page stack
 * (topmost first), then the page stack (topmost first). The first page that has music decides.
 *
 * Game UI surfaces have no page music, and a surface that is missing from the bundle names nothing.
 */
export function pageMusicCueFor(input: {
    surfaces: readonly (UISurface | null | undefined)[];
    tracks?: readonly ProjectAudioTrack[];
    locale?: string | null;
    sourceLocale?: string;
}): PageMusicCue | null {
    const tracks = input.tracks && input.tracks.length > 0 ? input.tracks : BUILTIN_AUDIO_TRACKS;
    for (const surface of input.surfaces) {
        const music = readUIPageMusic(surface);
        if (!surface || !music) {
            continue;
        }
        const assetId = resolveAssetVariantMember(
            surface.settings?.assetVariants,
            music.assetId,
            input.locale ?? undefined,
            input.sourceLocale,
        ) ?? music.assetId;
        const audioTrackId = resolveAudioTrack(tracks, music.audioTrackId, "bgm").id;
        const volume = Math.min(1, Math.max(0, music.volume ?? 1));
        return {
            key: `${assetId}\u0000${audioTrackId}`,
            surfaceId: surface.id,
            assetId,
            audioTrackId,
            volume,
            ...(music.loop !== undefined ? { loop: music.loop } : {}),
            fadeMs: Math.max(0, music.fadeMs ?? 0),
        };
    }
    return null;
}

/** How a host plays page music. `handle` is whatever its player hands back for one playing clip. */
export type PageMusicPlayer<THandle> = {
    /** Start a cue, fading in over its `fadeMs`. Null when nothing could be played. */
    play: (cue: PageMusicCue) => Promise<THandle | null>;
    stop: (handle: THandle, fadeMs: number) => void;
    setVolume: (handle: THandle, volume: number, fadeMs: number) => void;
    /**
     * The engine a sound started now would play on. A sound started on another one is gone: the
     * session it belonged to has been torn down, and its engine's audio with it.
     */
    currentEngine: () => unknown;
    /** True while a game holds the screen, or is about to; see the module header. */
    isHeld: () => boolean;
};

export type PageMusicController = {
    /** The music the pages on screen now call for. */
    update: (cue: PageMusicCue | null) => void;
    /** Ask again with the same pages, after something {@link PageMusicPlayer.isHeld} reads changed. */
    refresh: () => void;
    /** Stop at once and forget everything; the host is going away. */
    dispose: () => void;
};

type Playing<THandle> = {
    cue: PageMusicCue;
    handle: THandle | null;
    /** The engine the handle plays on; read once the play has settled. */
    engine: unknown;
    settled: boolean;
};

/**
 * One piece of page music at a time, handed over as the screen changes.
 *
 * A play is asynchronous - it may wait for the engine of a session still arriving - so a request is
 * held as "starting" until it settles, and one that settles after the screen has moved on, or after a
 * game has taken the screen, is stopped there and then rather than left playing over what came next.
 */
export function createPageMusicController<THandle>(player: PageMusicPlayer<THandle>): PageMusicController {
    let wanted: PageMusicCue | null = null;
    let current: Playing<THandle> | null = null;

    const start = (cue: PageMusicCue): void => {
        const entry: Playing<THandle> = { cue, handle: null, engine: undefined, settled: false };
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
                entry.engine = player.currentEngine();
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
        const target = player.isHeld() ? null : wanted;

        // Nothing is playing for a request that settled with nothing to play, or for one whose
        // session has since been replaced - a hot reload under the title, say. Either is asked again.
        if (current?.settled && (current.handle === null || current.engine !== player.currentEngine())) {
            if (current.handle !== null) {
                player.stop(current.handle, 0);
            }
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
                player.stop(current.handle, current.cue.fadeMs);
            }
            current = null;
        }
        if (target) {
            start(target);
        }
    };

    return {
        update: cue => {
            wanted = cue;
            reconcile();
        },
        refresh: reconcile,
        dispose: () => {
            wanted = null;
            if (current?.settled && current.handle !== null) {
                player.stop(current.handle, 0);
            }
            current = null;
        },
    };
}
