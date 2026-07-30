import { Sound, SoundType, type LiveGame } from "narraleaf-react";
import { audioClipRegionToSoundConfig, type AudioClipRegion } from "@shared/types/audio";
import type {
    BlueprintSoundPlayRequest,
    BlueprintSoundTransportRequest,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { GameAppHost, GameAppLogLevel } from "./GameAppHost";

/**
 * Audio playback for author-built screens (the blueprint `sound` family).
 *
 * Everything goes through the engine's own `AudioManager` rather than an `<audio>` element, for one
 * reason that decides the whole design: the manager owns the mix. A clip played on the `bgm` channel
 * is subject to the player's music slider and mute; a clip played on an element we created ourselves
 * would be neither, and would keep playing through a muted game. That also means the transport
 * operations (fade out, pause, resume, volume ramp) are the manager's rather than ours, which is why
 * this file holds almost no audio logic - it holds a registry.
 *
 * A handle addresses one *playback*, not a clip: playing the same track twice registers twice, which
 * is what lets a music screen cross-fade between two tracks of the same album.
 */

export type UiSoundPlaybackDeps = {
    /** The running engine, or null before a game has mounted (and in the editor's surface preview). */
    getLiveGame: () => LiveGame | null;
    resolveAssetUrl: GameAppHost["resolveStoryAssetUrl"];
    /** In/out points marked on the asset, so a Surface loops a track's body just like a story row does. */
    getClipRegion: (assetId: string) => AudioClipRegion | undefined;
    log: (level: GameAppLogLevel, message: string) => void;
};

export type UiSoundPlayback = {
    play: (request: BlueprintSoundPlayRequest) => Promise<string | null>;
    transport: (request: BlueprintSoundTransportRequest) => Promise<void>;
    isPlaying: (handleId: string | null) => boolean;
    /** Stop and forget everything, for teardown and relaunch. */
    dispose: () => void;
};

/**
 * The engine's mixer, as reached through a live game.
 *
 * `getGameState()` is typed as possibly-undefined (a game that has not mounted yet), so the manager
 * has to be named through a `NonNullable`.
 */
type EngineAudioManager = NonNullable<ReturnType<LiveGame["getGameState"]>>["audioManager"];

type Entry = {
    sound: Sound;
    /** Only used to answer `isPlaying`; the manager owns every state change. */
    isPlaying: () => boolean;
};

const CHANNELS: Record<BlueprintSoundPlayRequest["channel"], SoundType> = {
    bgm: SoundType.Bgm,
    sound: SoundType.Sound,
    voice: SoundType.Voice,
};

/**
 * A registry for hosts with no engine to play through (the story preview).
 *
 * The family's documented degrade is a null handle, not a thrown error: a graph that plays a click
 * sound has to run end to end in a preview, or the author cannot test the rest of it.
 */
export const SILENT_UI_SOUND: UiSoundPlayback = {
    play: async () => null,
    transport: async () => undefined,
    isPlaying: () => false,
    dispose: () => undefined,
};

export function createUiSoundPlayback(deps: UiSoundPlaybackDeps): UiSoundPlayback {
    const entries = new Map<string, Entry>();
    let nextId = 0;

    /**
     * The manager is reached through the live game every time rather than captured: a relaunch swaps
     * the `LiveGame`, and a captured manager would keep addressing the dead one's channels.
     */
    const audioManager = (): EngineAudioManager | null => {
        const liveGame = deps.getLiveGame();
        if (!liveGame) {
            return null;
        }
        try {
            return liveGame.getGameState()?.audioManager ?? null;
        } catch {
            return null;
        }
    };

    const play = async (request: BlueprintSoundPlayRequest): Promise<string | null> => {
        const manager = audioManager();
        if (!manager) {
            // The editor's surface preview has no engine. A button that plays a click sound must stay
            // clickable there, so this is a warning and a null handle rather than a thrown error.
            deps.log("warning", "Play Sound: no game audio is running; the clip was not played.");
            return null;
        }
        const url = await deps.resolveAssetUrl(request.assetId, "audio");
        if (!url) {
            deps.log("warning", `Play Sound: audio asset "${request.assetId}" could not be resolved.`);
            return null;
        }
        const sound = new Sound({
            src: url,
            type: CHANNELS[request.channel] ?? SoundType.Sound,
            loop: request.loop === true,
            volume: request.volume ?? 1,
            ...audioClipRegionToSoundConfig(deps.getClipRegion(request.assetId)),
        });
        let token;
        try {
            token = await manager.playSoundToken(sound, {
                end: request.volume ?? 1,
                duration: request.fadeMs ?? 0,
            });
        } catch (error) {
            deps.log("warning", `Play Sound: playback failed (${error instanceof Error ? error.message : String(error)}).`);
            return null;
        }
        const id = `sound_${++nextId}`;
        entries.set(id, { sound, isPlaying: () => token.isPlaying() });
        if (request.loop !== true) {
            // A one-shot that runs out is still registered with the manager, and nothing else would
            // ever take it off its books. Looping clips are stopped explicitly, so they need no hook.
            token.once("ended", () => {
                void manager.stop(sound);
                entries.delete(id);
            });
        }
        return id;
    };

    const transport = async (request: BlueprintSoundTransportRequest): Promise<void> => {
        const manager = audioManager();
        if (!manager) {
            return;
        }
        // A null handle only reaches here from Stop Sound, where it means "everything this family
        // started" - the escape hatch for a Page-exit handler.
        const targets = request.handleId === null
            ? [...entries.keys()]
            : entries.has(request.handleId) ? [request.handleId] : [];
        for (const id of targets) {
            const entry = entries.get(id);
            if (!entry) {
                continue;
            }
            switch (request.operation) {
                case "stop":
                    await manager.stop(entry.sound, request.fadeMs ?? 0);
                    entries.delete(id);
                    break;
                case "pause":
                    await manager.pause(entry.sound, request.fadeMs ?? 0);
                    break;
                case "resume":
                    await manager.resume(entry.sound, request.fadeMs ?? 0);
                    break;
                case "setVolume":
                    await manager.setVolume(entry.sound, request.volume ?? 1, request.fadeMs ?? 0);
                    break;
                case "seek":
                    // Milliseconds in the graph, seconds at the engine boundary - the same conversion
                    // the story compiler makes.
                    await manager.seek(entry.sound, (request.timeMs ?? 0) / 1000);
                    break;
            }
        }
    };

    return {
        play,
        transport,
        isPlaying: handleId => (handleId ? entries.get(handleId)?.isPlaying() === true : false),
        dispose: () => {
            const manager = audioManager();
            for (const entry of entries.values()) {
                try {
                    void manager?.stop(entry.sound);
                } catch {
                    // Teardown is best effort: a manager whose context is already gone is not a failure.
                }
            }
            entries.clear();
        },
    };
}
