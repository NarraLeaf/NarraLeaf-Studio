/**
 * The player's preferences: the author's starting point, and what the player has done to it.
 *
 * Two halves, like the audio buses next door:
 *
 * 1. **The defaults** are the author's. They come out of `.nlproj` `app.preferences`, travel in the
 *    bundle, and are imported into `game.preference` once, before the Player mounts. Before this
 *    existed the only way to set one was a blueprint wired behind `App Boot` - one `Set ...` node
 *    per preference - so a project without that page shipped the engine's defaults whether the
 *    author knew it or not.
 * 2. **The values** are the player's. They change while the game runs (a settings screen, a
 *    `Set BGM Volume` node, the engine itself) and this module keeps them in the app's own storage,
 *    so a player who turns the voices down finds them down next launch.
 *
 * Without the second half the first is a trap: an author who moves a default would be moving it for
 * *every* player, including the ones who already chose otherwise, because nothing was ever kept.
 * The engine has no persistence of its own here - `exportPreferences` / `importPreferences` have no
 * call sites inside it - so this is where it happens.
 *
 * `skipReadText` rides in the same store even though the engine has never heard of it. The engine's
 * `Preference` is a plain keyed map with a change event, so an extra key costs it nothing, and in
 * exchange the new preference reaches every surface the others already reach: the blueprint
 * `Get`/`Set` pair, the `gamePreferenceChanged` event, this persistence, and one settings page.
 * What acts on it is Studio (see `skipRunController`).
 *
 * `autoForwardDelay` rides the same way but has a second half: the engine reads it from
 * `game.config`, not from the preference store, so a value here means nothing until it is copied
 * across. {@link PlayerPreferencePersistenceOptions.configureEngine} is that copy, applied once on
 * the boot path and again on every change, which is what makes a settings screen's slider move the
 * pace of the game rather than a number nobody reads.
 *
 * Comments in English per project convention.
 */

import {
    DEFAULT_PLAYER_PREFERENCES,
    PLAYER_PREFERENCE_KEYS,
    PLAYER_PREFERENCE_SPECS,
    normalizePlayerPreference,
    type PlayerPreferenceKey,
    type PlayerPreferenceValue,
    type PlayerPreferences,
} from "@shared/types/preference";

/**
 * Where the player's preferences live in scope persistence.
 *
 * One key holding the whole map, for the same reasons the bus volumes are one key: the engine's own
 * API is map-shaped on both sides (`getPreferences()` returns what `importPreferences()` takes),
 * restore happens once on the path to the first frame and must not cost a round trip per
 * preference, and a key per preference would leave orphans behind in a store shared with the locale
 * and the read-text record.
 */
export const PLAYER_PREFERENCES_PERSISTENCE_KEY = "game.preferences";

/** The minimum of `Game.preference` this module needs; structural so tests need no engine. */
export type PreferenceStoreLike = {
    getPreferences: () => Record<string, unknown>;
    importPreferences: (values: Record<string, unknown>) => void;
    onPreferenceChange: (listener: (key: string, value: unknown) => void) => { cancel?: () => void } | void;
};

export type PlayerPreferencePersistenceOptions = {
    /** `game.preference`. */
    preference: PreferenceStoreLike | undefined;
    /**
     * The project's authored defaults. Absent (a bundle assembled before the feature) means the
     * engine's own, which is exactly how those bundles already behaved.
     */
    defaults?: PlayerPreferences;
    read: (key: string) => Promise<unknown> | unknown;
    write: (key: string, value: unknown) => Promise<void> | void;
    /**
     * Push the preferences the engine keeps as *config* into the game (`Game.configure`).
     *
     * There is one today, `autoForwardDelay`. The engine reads it per line straight off
     * `game.config`, so this is what a player changing it in a settings screen actually moves, and
     * omitting it (the story preview, tests) simply leaves the engine's own value in place.
     */
    configureEngine?: (config: { autoForwardDelay: number }) => void;
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

/**
 * A persisted value as a preference map, from whatever was in the store.
 *
 * **Sparse on purpose**, unlike the authored defaults: what is stored is the set of preferences the
 * player has actually moved, so a key that is absent has to mean "leave the author's default alone"
 * rather than "reset to the engine's". An author who raises the starting text speed then reaches
 * every player who never touched the slider, which is the only reading of a default that is worth
 * anything.
 *
 * Total: an unreadable store, or an entry naming a preference this Studio does not have, lands the
 * player on the authored defaults rather than throwing on the boot path.
 */
export function readPersistedPlayerPreferences(raw: unknown): Partial<PlayerPreferences> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const record = raw as Record<string, unknown>;
    const stored: Record<string, PlayerPreferenceValue> = {};
    for (const key of PLAYER_PREFERENCE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
            stored[key] = normalizePlayerPreference(key, record[key]);
        }
    }
    return stored as Partial<PlayerPreferences>;
}

/** The known preferences out of a live store, ready to be written back. */
function collectPlayerPreferences(preference: PreferenceStoreLike): Partial<PlayerPreferences> {
    const current = preference.getPreferences();
    const collected: Record<string, PlayerPreferenceValue> = {};
    for (const key of PLAYER_PREFERENCE_KEYS) {
        const value = current[key];
        if (value !== undefined) {
            collected[key] = normalizePlayerPreference(key, value);
        }
    }
    return collected as Partial<PlayerPreferences>;
}

/**
 * Seed a freshly constructed game with the authored defaults, restore whatever the player has
 * chosen on top of them, then keep the store in step with every change.
 *
 * Call after `new Game(...)` and before the Player mounts: the dialogue's typing speed and the
 * volume the first clip plays at are both read as the component mounts, so a value applied later is
 * a value the first line was not shown at.
 *
 * Writes the **whole** known map on every change rather than the one key that moved, so the store
 * always holds a complete picture of what the player has settled on - a partial write would let a
 * crash between two changes leave half the settings screen at the author's defaults and half at the
 * player's.
 *
 * Returns a disposer for the subscription.
 */
export async function attachPlayerPreferences(
    options: PlayerPreferencePersistenceOptions,
): Promise<() => void> {
    const { preference, defaults, read, write, configureEngine, log } = options;
    if (!preference || typeof preference.importPreferences !== "function") {
        return () => undefined;
    }

    // The authored defaults first, unconditionally: they are the floor every launch starts from,
    // and a store that has never been written must still move the game off the engine's values.
    try {
        preference.importPreferences({ ...DEFAULT_PLAYER_PREFERENCES, ...(defaults ?? {}) });
    } catch (error) {
        log?.("warning", `Preference defaults could not be applied: ${String(error)}`);
    }

    try {
        const stored = readPersistedPlayerPreferences(await read(PLAYER_PREFERENCES_PERSISTENCE_KEY));
        if (Object.keys(stored).length > 0) {
            preference.importPreferences(stored as Record<string, unknown>);
        }
    } catch (error) {
        // A store that cannot be read is a player who starts at the authored defaults, not a game
        // that fails to boot.
        log?.("warning", `Player preferences could not be restored: ${String(error)}`);
    }

    // Once the store holds the effective values, and before the Player mounts: the first line's
    // auto-forward wait is read as it plays, so a config applied later is a line already paced by
    // the engine's own number.
    applyEngineConfig(preference, configureEngine, log);

    let disposed = false;
    // Subscribed after both imports so the boot path writes nothing: the restore would otherwise
    // fire a change per key and echo the store straight back at itself.
    const token = preference.onPreferenceChange((key: string) => {
        if (disposed || !isKnownPreference(key)) {
            return;
        }
        if (key === "autoForwardDelay") {
            applyEngineConfig(preference, configureEngine, log);
        }
        try {
            void write(PLAYER_PREFERENCES_PERSISTENCE_KEY, collectPlayerPreferences(preference));
        } catch (error) {
            log?.("warning", `Player preferences could not be saved: ${String(error)}`);
        }
        // Nothing is notified from here. The host already fans preference changes out to whoever
        // has to re-read one (`subscribeGamePreferenceChanges` -> the blueprint event and the
        // mixer listeners), and it subscribes to this same store - a second fan-out would deliver
        // every volume change twice.
    });

    return () => {
        disposed = true;
        (token as { cancel?: () => void } | undefined)?.cancel?.();
    };
}

function isKnownPreference(key: string): key is PlayerPreferenceKey {
    return (PLAYER_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/**
 * Mirror the config-backed preferences onto the game.
 *
 * Total, like everything else on this path: a store that answers with nonsense falls back to the
 * spec's default rather than handing the engine a `NaN` it would divide a delay by.
 */
function applyEngineConfig(
    preference: PreferenceStoreLike,
    configureEngine: ((config: { autoForwardDelay: number }) => void) | undefined,
    log?: (level: "info" | "warning" | "error", message: string) => void,
): void {
    if (!configureEngine) {
        return;
    }
    try {
        const raw = preference.getPreferences()["autoForwardDelay"];
        const value = normalizePlayerPreference("autoForwardDelay", raw);
        configureEngine({
            autoForwardDelay: typeof value === "number"
                ? value
                : PLAYER_PREFERENCE_SPECS.autoForwardDelay.defaultValue as number,
        });
    } catch (error) {
        log?.("warning", `Auto forward wait could not be applied: ${String(error)}`);
    }
}
