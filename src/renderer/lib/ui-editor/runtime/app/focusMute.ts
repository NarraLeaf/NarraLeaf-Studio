/**
 * "Go quiet while I am in another window": the player preference, and the gate behind it.
 *
 * The preference is `muteOnWindowBlur` and it is off unless a player turns it on. What acts on it
 * is here, and it is deliberately not a volume: nothing this module writes is ever persisted, read
 * back by a node, or shown on a settings screen. It is a gate over the game's whole output which is
 * open (1) or shut (0), and the number underneath it - the player's master volume - is put back
 * exactly as it was found the moment the window comes back.
 *
 * ## Why this is not `globalVolume`
 *
 * The obvious implementation is to write the master volume preference to 0 and back. It is wrong in
 * two ways at once: the player's own master slider would jump to zero while they were not looking
 * at it, and the preference store is persisted - a player who quit the game from another window
 * would come back to a title that is silent forever with a slider that says it is not.
 *
 * So the gate is written onto the engine's audio output instead (`AudioManager.setGlobalVolume`),
 * which is the same lever the engine's own fast-forward takes for the same reason: a temporary
 * silence that nothing else is allowed to notice. The player's preference is untouched throughout.
 *
 * ## The other writer, and why the order works out
 *
 * The engine copies `globalVolume` onto that output whenever the preference changes, and reads it
 * back into the preference once when its player mounts. Two consequences this module is built
 * around:
 *
 *  - a `globalVolume` change that arrives while the gate is shut re-opens the output, so the caller
 *    re-asserts on every preference change as well as on every focus change - {@link
 *    FocusMuteController.update} is idempotent precisely so that it can be called that way;
 *  - the gate must never be shut across the engine's player mounting, or the copy would take the
 *    gated zero for the player's master volume. {@link FocusMuteController.release} exists for
 *    that: the caller releases on teardown, before anything can remount underneath it.
 *
 * ## Video
 *
 * A `<video>` element is not on any gain node (see `videoMixer`), so the gate reaches it as a
 * multiplier instead: {@link FocusMuteController.getGain} is what the host answers
 * `onGetAudioOutputGain` with, and the host announces a change on the same stream a slider drag
 * travels on. One fact, two appliers, because the two sounds genuinely come out of two places.
 *
 * Comments in English per project convention.
 */

/**
 * The engine's audio output, as much of it as this needs.
 *
 * Structural rather than imported so a test can drive the whole controller with two functions, and
 * so an engine dist without the pair degrades to "the gate does nothing" rather than throwing on a
 * settings screen.
 */
export type FocusMuteOutput = {
    getGlobalVolume: () => number;
    setGlobalVolume: (volume: number) => void;
};

export type FocusMuteInput = {
    /** The player's `muteOnWindowBlur` preference. */
    enabled: boolean;
    /** Whether the game's window is the one the player is working in. */
    focused: boolean;
};

export type FocusMuteController = {
    /**
     * How much of the game's own output is getting through, 0..1.
     *
     * Two values in practice, and it is a number rather than a boolean because that is what the
     * one consumer outside the engine's graph multiplies by.
     */
    getGain: () => number;
    /**
     * Bring the gate into line with what the window and the preference say.
     *
     * Idempotent and safe to call on anything that might have changed either of them - including a
     * `globalVolume` change, which the engine answers by re-opening the output underneath a shut
     * gate. Returns whether the gate moved, so a caller can announce it without keeping its own
     * copy of the state.
     */
    update: (input: FocusMuteInput) => boolean;
    /**
     * Open the gate and put the output back at the volume it was found at, whatever the input says.
     *
     * For teardown: leaving a zero on the engine's output across a player remount would let the
     * engine read it back as the player's master volume. Returns whether the gate moved.
     */
    release: () => boolean;
};

export type FocusMuteOptions = {
    /**
     * The engine's output, read at call time.
     *
     * A function because a game is built, torn down and built again under a controller whose
     * identity is stable across all of it, and a captured output would be the previous game's.
     */
    output: () => FocusMuteOutput | null;
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

export function createFocusMuteController(options: FocusMuteOptions): FocusMuteController {
    const { output, log } = options;
    /** The volume found on the output when the gate shut, or null while the gate is open. */
    let restoreTo: number | null = null;

    const write = (volume: number): boolean => {
        const target = output();
        if (!target || typeof target.setGlobalVolume !== "function") {
            return false;
        }
        try {
            target.setGlobalVolume(volume);
            return true;
        } catch (error) {
            // A game that fails to go quiet is a game that keeps playing, not one that stops.
            log?.("warning", `Mute when unfocused could not reach the audio output: ${String(error)}`);
            return false;
        }
    };

    const open = (): boolean => {
        if (restoreTo === null) {
            return false;
        }
        const volume = restoreTo;
        // Cleared before the write, so a write that throws still leaves the gate open rather than
        // holding a stale capture that a later release would put back over the player's own change.
        restoreTo = null;
        write(volume);
        return true;
    };

    /** What the output is sitting at, or null when it cannot be read. */
    const read = (): number | null => {
        const target = output();
        if (!target || typeof target.getGlobalVolume !== "function") {
            return null;
        }
        try {
            const found = Number(target.getGlobalVolume());
            return Number.isFinite(found) ? found : null;
        } catch (error) {
            log?.("warning", `Mute when unfocused could not read the audio output: ${String(error)}`);
            return null;
        }
    };

    const shut = (): boolean => {
        const found = read();
        if (found === null || !write(0)) {
            return false;
        }
        restoreTo = found;
        return true;
    };

    return {
        getGain: () => (restoreTo === null ? 1 : 0),
        update: ({ enabled, focused }) => {
            const shouldMute = enabled && !focused;
            if (shouldMute) {
                if (restoreTo !== null) {
                    // Already shut, and being re-asserted. The engine re-opens the output whenever
                    // `globalVolume` changes, so anything above zero here is a master volume set
                    // since the gate shut: it becomes what gets restored, or the change would be
                    // undone the moment the player came back.
                    const found = read();
                    if (found !== null && found > 0) {
                        restoreTo = found;
                    }
                    write(0);
                    return false;
                }
                return shut();
            }
            return open();
        },
        release: open,
    };
}
