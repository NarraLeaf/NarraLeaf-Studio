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
 * `showDialog` is the exception to the second half: it is the player's hide-the-box gesture, which
 * describes one playthrough rather than a choice to keep, so it is never stored and every new game
 * or loaded save starts it at the author's value - see {@link PLAYTHROUGH_PREFERENCE_KEYS}.
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
import { AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE } from "@shared/types/audioTrack";
import { AUDIO_BUS_VOLUMES_PERSISTENCE_KEY, readPersistedBusVolumes } from "./audioBusRuntime";

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
 * The preferences that belong to the playthrough on screen rather than to the player.
 *
 * `showDialog` is the player putting the dialogue box away to look at the picture behind it - the
 * quick menu's Hide, a long press, a `Hide Dialog` node. It lives in the preference store because
 * that is where the engine's box reads it from, but it is a gesture rather than a setting: a player
 * who hid the box to look at one picture has not chosen to start every later game without one. Kept
 * as a setting, it was restored on the next launch and outlived a return to the title, so a new game
 * or a loaded save opened with its first line already hidden and nothing on screen saying why.
 *
 * So these are neither restored from the store nor written to it, and every playthrough starts them
 * again at the author's value ({@link startPlaythroughPreferences}). The author's value still means
 * what Project ▸ Game ▸ Player defaults says it means: the state a game starts in.
 */
export const PLAYTHROUGH_PREFERENCE_KEYS: readonly PlayerPreferenceKey[] = ["showDialog"];

function isPlaythroughPreference(key: string): boolean {
    return (PLAYTHROUGH_PREFERENCE_KEYS as readonly string[]).includes(key);
}

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
 * player on the authored defaults rather than throwing on the boot path. A store written before
 * {@link PLAYTHROUGH_PREFERENCE_KEYS} existed still carries the last hide a player left on; that
 * entry is skipped here and dropped by the next write.
 */
export function readPersistedPlayerPreferences(raw: unknown): Partial<PlayerPreferences> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const record = raw as Record<string, unknown>;
    const stored: Record<string, PlayerPreferenceValue> = {};
    for (const key of PLAYER_PREFERENCE_KEYS) {
        if (isPlaythroughPreference(key)) {
            continue;
        }
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
        if (isPlaythroughPreference(key)) {
            continue;
        }
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
        // A playthrough preference is not kept, so a change to one has nothing to write.
        if (disposed || !isKnownPreference(key) || isPlaythroughPreference(key)) {
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
 * Start a playthrough's own preferences at the author's values.
 *
 * Call as a playthrough begins - before `newGame()`, whether it is about to play from the start or
 * have a save deserialized into it - so the first line mounts with the box in the state the author
 * chose and `Is Dialog Shown` agrees with what is drawn from that line on.
 *
 * Only a value that differs is written. Writing goes through the store's own setter, so whatever
 * listens - the engine's box, the blueprint `gamePreferenceChanged` event - hears it, and a game
 * that already agrees (the ordinary case) hears nothing at all.
 */
export function startPlaythroughPreferences(
    preference: PreferenceStoreLike | undefined,
    defaults?: PlayerPreferences,
): void {
    if (!preference || typeof preference.importPreferences !== "function") {
        return;
    }
    const authored: PlayerPreferences = { ...DEFAULT_PLAYER_PREFERENCES, ...(defaults ?? {}) };
    const current = preference.getPreferences();
    const changed: Record<string, unknown> = {};
    for (const key of PLAYTHROUGH_PREFERENCE_KEYS) {
        if (current[key] !== authored[key]) {
            changed[key] = authored[key];
        }
    }
    if (Object.keys(changed).length > 0) {
        preference.importPreferences(changed);
    }
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

/**
 * The volume preferences that are the player's half of a seeded audio bus, by preference.
 *
 * `bgmVolume`, `soundVolume` and `voiceVolume` are not copies of those buses' volumes in the engine,
 * they *are* them: one storage, two names. So the player's choice is kept twice over - under this
 * module's key and under the bus map's ({@link AUDIO_BUS_VOLUMES_PERSISTENCE_KEY}) - and the boot path
 * restores the bus map second, which makes the bus map the answer a game starts with. The global
 * volume has no bus of its own and is kept here only.
 */
const BUS_BACKED_PREFERENCES: Readonly<Partial<Record<PlayerPreferenceKey, string>>> = Object.freeze({
    bgmVolume: AUDIO_TRACK_ID_BGM,
    soundVolume: AUDIO_TRACK_ID_SOUND,
    voiceVolume: AUDIO_TRACK_ID_VOICE,
});

export type DetachedPlayerPreferencesOptions = {
    /** The project's authored defaults, read at call time so a hot reload is seen. */
    getDefaults: () => PlayerPreferences | undefined;
    /**
     * This window's copy of the persistent store, read synchronously (`scopeBridge.persistenceGet`).
     * A getter node answers in the same tick it is asked, so it cannot wait for a round trip.
     */
    read: (key: string) => unknown;
    /** A durable write (`scopeBridge.persistenceSet`), awaited so a game started next reads it. */
    write: (key: string, value: unknown) => Promise<void> | void;
    /**
     * The preference store of a game that has been constructed but is not live yet, or null.
     *
     * A title screen is often up while the game behind it is still mounting (the boot preload, the
     * menu's session after a quit), and that game has already restored its preferences from the map
     * by then - so a value written only to the map would be missing from it and read back as the old
     * one once it goes live. A write is handed to this store as well, which is what the game then
     * plays with and keeps writing back.
     */
    getBootingStore?: () => PreferenceStoreLike | null | undefined;
    /** Told after a write that changed what a reader would see; the host fans it out as it does a live change. */
    onChange?: (key: PlayerPreferenceKey, value: PlayerPreferenceValue, previousValue: PlayerPreferenceValue) => void;
};

export type DetachedPlayerPreferences = {
    /**
     * Whether this store answers for `key` while no game runs. The kept preferences do, and so does
     * a playthrough preference for reading (a new game starts it at the author's value); writing a
     * playthrough preference does not, because there is no playthrough for it to describe.
     */
    canRead: (key: string) => key is PlayerPreferenceKey;
    canWrite: (key: string) => key is PlayerPreferenceKey;
    /** The value the next game will start with. */
    get: (key: PlayerPreferenceKey) => PlayerPreferenceValue;
    /** Keep a new value for the next game to start with. */
    set: (key: PlayerPreferenceKey, value: unknown) => Promise<void>;
};

/**
 * The player's preferences while no game is running: a settings screen opened from the title.
 *
 * A game's preferences live in its engine store, which exists only from `new Game()` on, and the
 * blueprint `Get`/`Set` nodes used to reach nothing else - so a settings screen opened before any
 * game refused every row with "needs a running game" and showed the node defaults. Yet what such a
 * screen edits is exactly what {@link attachPlayerPreferences} restores when a game does start, and
 * what a running game keeps writing: the persisted map. This reads and writes that map directly, on
 * the same terms as the boot path, so the two cannot disagree:
 *
 * - **Reading** answers what a game started now would hold - the author's default, under the
 *   player's stored choice, under the bus map for the three bus-backed volumes - which is also what
 *   a running game last wrote, so a value changed in game reads back on the title screen.
 * - **Writing** keeps the map sparse - it adds the one key to what is stored rather than freezing
 *   every author default - and writes the bus map too for a bus-backed volume, because the boot path
 *   restores that second and would otherwise put an older bus value back over the player's choice.
 *
 * Never used while a game runs: the engine store is then the source of truth and writes the map on
 * every change itself.
 */
export function createDetachedPlayerPreferences(
    options: DetachedPlayerPreferencesOptions,
): DetachedPlayerPreferences {
    const { getDefaults, read, write, getBootingStore, onChange } = options;

    const authoredValue = (key: PlayerPreferenceKey): PlayerPreferenceValue => normalizePlayerPreference(
        key,
        { ...DEFAULT_PLAYER_PREFERENCES, ...(getDefaults() ?? {}) }[key],
    );

    const storedBusVolumes = (): Record<string, number> => {
        try {
            return readPersistedBusVolumes(read(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY));
        } catch {
            return {};
        }
    };

    const storedPreferences = (): Partial<PlayerPreferences> => {
        try {
            return readPersistedPlayerPreferences(read(PLAYER_PREFERENCES_PERSISTENCE_KEY));
        } catch {
            return {};
        }
    };

    const get = (key: PlayerPreferenceKey): PlayerPreferenceValue => {
        if (isPlaythroughPreference(key)) {
            return authoredValue(key);
        }
        const busId = BUS_BACKED_PREFERENCES[key];
        if (busId) {
            const busVolumes = storedBusVolumes();
            if (Object.prototype.hasOwnProperty.call(busVolumes, busId)) {
                return normalizePlayerPreference(key, busVolumes[busId]);
            }
        }
        const stored = storedPreferences();
        return Object.prototype.hasOwnProperty.call(stored, key)
            ? stored[key] as PlayerPreferenceValue
            : authoredValue(key);
    };

    return {
        canRead: (key: string): key is PlayerPreferenceKey => isKnownPreference(key),
        canWrite: (key: string): key is PlayerPreferenceKey => isKnownPreference(key) && !isPlaythroughPreference(key),
        get,
        set: async (key: PlayerPreferenceKey, value: unknown): Promise<void> => {
            if (!isKnownPreference(key) || isPlaythroughPreference(key)) {
                return;
            }
            const previousValue = get(key);
            const next = normalizePlayerPreference(key, value);
            await write(PLAYER_PREFERENCES_PERSISTENCE_KEY, { ...storedPreferences(), [key]: next });
            const busId = BUS_BACKED_PREFERENCES[key];
            if (busId && typeof next === "number") {
                await write(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY, { ...storedBusVolumes(), [busId]: next });
            }
            const booting = getBootingStore?.();
            if (booting && typeof booting.importPreferences === "function") {
                booting.importPreferences({ [key]: next });
            }
            if (previousValue !== next) {
                onChange?.(key, next, previousValue);
            }
        },
    };
}
