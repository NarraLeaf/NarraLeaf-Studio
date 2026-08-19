/**
 * The player preferences a project ships defaults for.
 *
 * A preference is the *player's* setting - text speed, volumes, whether skipping is allowed - and it
 * lives in the running game, changes while they play, and follows the app's own storage rather than
 * a save file. What the author owns is the **starting point**: the value a player has before they
 * have ever opened the settings screen. That is what this module describes.
 *
 * Until now the only way to set one was a blueprint: `Set BGM Volume` wired behind `App Boot`, one
 * node per preference, and an author who never built that page shipped whatever the engine happened
 * to default to. So the defaults are project data now - authored once in Project -> Game,
 * baked into the bundle, applied to the game at boot, and still fully writable at runtime by the
 * same nodes as before.
 *
 * Shared because all four sides need the same table: the project settings UI renders it, the
 * main-process bundle assembler bakes it, the game app applies it to `game.preference`, and the
 * blueprint layer validates keys against it.
 *
 * ## Why one spec table instead of a type plus three switch statements
 *
 * Every one of those sides needs the same three facts about a preference - what kind of value it
 * holds, what its default is, and what range is meaningful. Split across the layers they drift: the
 * blueprint `Set Game Speed` node already clamps to "> 0" while the engine documents 1.0 and the
 * settings page would have invented a third bound. Here the table is the single answer and each
 * consumer reads the field it needs from it.
 *
 * Comments in English per project convention.
 */

/** How a voice clip ends when its sentence does. Mirrors the engine's own union. */
export const VOICE_END_MODES = ["stop", "fade", "none"] as const;
export type VoiceEndMode = typeof VOICE_END_MODES[number];

/**
 * Every preference key, in the order Project -> Game shows them.
 *
 * Twelve of these are the engine's own `GamePreference` keys and are passed through to it verbatim.
 * `skipReadText` and `autoForwardDelay` are Studio's (see {@link PLAYER_PREFERENCE_SPECS}); they
 * ride in the same preference store so that one screen, one persistence key and one set of
 * blueprint nodes cover all of them.
 *
 * Not every preference an author can reach is here - see {@link RUNTIME_PREFERENCE_KEYS} for the
 * ones that exist only while the game runs.
 */
export const PLAYER_PREFERENCE_KEYS = [
    "cps",
    "gameSpeed",
    "autoForward",
    "autoForwardDelay",
    "showDialog",
    "skip",
    "skipReadText",
    "skipDelay",
    "skipInterval",
    "globalVolume",
    "bgmVolume",
    "soundVolume",
    "voiceVolume",
    "voiceEndMode",
    "voiceFadeDuration",
] as const;

export type PlayerPreferenceKey = typeof PLAYER_PREFERENCE_KEYS[number];

export type PlayerPreferenceValue = boolean | number | VoiceEndMode;

export type PlayerPreferences = {
    /** Characters per second the dialogue types at. */
    cps: number;
    /** Multiplier over text speed and the auto-forward delay; 1 is the authored pace. */
    gameSpeed: number;
    /** Advance on its own once a line has finished displaying. */
    autoForward: boolean;
    /** Milliseconds auto-forward waits at the end of a line before advancing. */
    autoForwardDelay: number;
    /** Whether the dialogue box is shown at all. */
    showDialog: boolean;
    /** Whether the player may skip. False disables the skip key outright. */
    skip: boolean;
    /** Skip stops when it reaches a line the player has not read yet. */
    skipReadText: boolean;
    /** Milliseconds the skip key is held before continuous skipping starts. */
    skipDelay: number;
    /** Milliseconds between skipped lines while the key is held. */
    skipInterval: number;
    /** Master output, 0..1. */
    globalVolume: number;
    /** Music bus, 0..1. */
    bgmVolume: number;
    /** SFX bus, 0..1. */
    soundVolume: number;
    /** Voice bus, 0..1. */
    voiceVolume: number;
    /** What happens to a voice clip when its sentence ends. */
    voiceEndMode: VoiceEndMode;
    /** Fade length in milliseconds when `voiceEndMode` is `fade`. */
    voiceFadeDuration: number;
};

/**
 * How a numeric preference is edited.
 *
 * `percent` values are stored 0..1 (or, for `gameSpeed`, as a multiplier) and edited as whole
 * percent, because "72%" is what a volume reads as everywhere else in Studio and `0.72` in a number
 * field is not a control anyone recognises. `count` values are stored and edited in the same unit.
 */
export type PlayerPreferenceDisplay =
    | { unit: "percent"; control: "slider" | "field" }
    | { unit: "ms" | "cps"; control: "field" };

export type PlayerPreferenceSpec =
    | {
        key: PlayerPreferenceKey;
        kind: "boolean";
        defaultValue: boolean;
    }
    | {
        key: PlayerPreferenceKey;
        kind: "number";
        defaultValue: number;
        /** Inclusive bounds in **stored** units. */
        min: number;
        max: number;
        display: PlayerPreferenceDisplay;
    }
    | {
        key: PlayerPreferenceKey;
        kind: "enum";
        defaultValue: VoiceEndMode;
        options: readonly VoiceEndMode[];
    };

/**
 * The table. Defaults match the engine's own `Game.DefaultPreference` exactly, so a project that
 * never opens this page behaves as it always did.
 *
 * Bounds are the author-facing ones and are deliberately narrower than "any finite number": the
 * engine divides by `gameSpeed` and paces skipping by `skipInterval`, so zero is not a slow game,
 * it is a hung one. They are also what the settings page offers, which is why they live here rather
 * than in the section component.
 */
export const PLAYER_PREFERENCE_SPECS: Readonly<Record<PlayerPreferenceKey, PlayerPreferenceSpec>> = {
    cps: {
        key: "cps",
        kind: "number",
        defaultValue: 10,
        min: 1,
        max: 200,
        display: { unit: "cps", control: "field" },
    },
    gameSpeed: {
        key: "gameSpeed",
        kind: "number",
        defaultValue: 1,
        min: 0.1,
        max: 10,
        display: { unit: "percent", control: "field" },
    },
    autoForward: { key: "autoForward", kind: "boolean", defaultValue: false },
    /**
     * The engine holds this as game *config* rather than as a preference, and Studio never passed
     * it, so every project shipped with the engine's 3000ms however the writing was paced. It is a
     * preference here because it is the player's to change - the row a settings screen offers next
     * to auto-forward itself - and the host copies it into `game.config` at boot and on every
     * change (see `preferenceRuntime`).
     *
     * `gameSpeed` is not this control: the engine divides the typing speed by it as well, so a
     * player who wanted a longer pause between lines would get slower text with it.
     */
    autoForwardDelay: {
        key: "autoForwardDelay",
        kind: "number",
        defaultValue: 3000,
        min: 0,
        max: 30000,
        display: { unit: "ms", control: "field" },
    },
    showDialog: { key: "showDialog", kind: "boolean", defaultValue: true },
    skip: { key: "skip", kind: "boolean", defaultValue: true },
    /**
     * Off by default, and that is the whole design of it: a game that silently refuses to skip
     * text the player has not seen is a game whose skip key looks broken. The author turns it on
     * when their story is one people replay.
     */
    skipReadText: { key: "skipReadText", kind: "boolean", defaultValue: false },
    skipDelay: {
        key: "skipDelay",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 5000,
        display: { unit: "ms", control: "field" },
    },
    skipInterval: {
        key: "skipInterval",
        kind: "number",
        defaultValue: 100,
        min: 1,
        max: 5000,
        display: { unit: "ms", control: "field" },
    },
    globalVolume: {
        key: "globalVolume",
        kind: "number",
        defaultValue: 1,
        min: 0,
        max: 1,
        display: { unit: "percent", control: "slider" },
    },
    bgmVolume: {
        key: "bgmVolume",
        kind: "number",
        defaultValue: 1,
        min: 0,
        max: 1,
        display: { unit: "percent", control: "slider" },
    },
    soundVolume: {
        key: "soundVolume",
        kind: "number",
        defaultValue: 1,
        min: 0,
        max: 1,
        display: { unit: "percent", control: "slider" },
    },
    voiceVolume: {
        key: "voiceVolume",
        kind: "number",
        defaultValue: 1,
        min: 0,
        max: 1,
        display: { unit: "percent", control: "slider" },
    },
    voiceEndMode: {
        key: "voiceEndMode",
        kind: "enum",
        defaultValue: "stop",
        options: VOICE_END_MODES,
    },
    voiceFadeDuration: {
        key: "voiceFadeDuration",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 10000,
        display: { unit: "ms", control: "field" },
    },
};

/**
 * The engine's defaults, as a complete set. What a project that never touched the page ships.
 */
export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
    cps: 10,
    gameSpeed: 1,
    autoForward: false,
    autoForwardDelay: 3000,
    showDialog: true,
    skip: true,
    skipReadText: false,
    skipDelay: 0,
    skipInterval: 100,
    globalVolume: 1,
    bgmVolume: 1,
    soundVolume: 1,
    voiceVolume: 1,
    voiceEndMode: "stop",
    voiceFadeDuration: 0,
};

/**
 * The preferences grouped the way the settings page reads them.
 *
 * Fifteen switches in one flat column is a list nobody scans; grouped, an author looking for "why
 * does skipping run off the end of what I have read" finds it under Skipping rather than three
 * rows below a volume slider.
 */
export const PLAYER_PREFERENCE_GROUPS: readonly {
    id: "dialogue" | "skipping" | "audio";
    keys: readonly PlayerPreferenceKey[];
}[] = [
    { id: "dialogue", keys: ["cps", "gameSpeed", "autoForward", "autoForwardDelay", "showDialog"] },
    { id: "skipping", keys: ["skip", "skipReadText", "skipDelay", "skipInterval"] },
    {
        id: "audio",
        keys: ["globalVolume", "bgmVolume", "soundVolume", "voiceVolume", "voiceEndMode", "voiceFadeDuration"],
    },
];

function clampNumber(value: unknown, spec: Extract<PlayerPreferenceSpec, { kind: "number" }>): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return spec.defaultValue;
    }
    return Math.min(spec.max, Math.max(spec.min, parsed));
}

/**
 * Coerce one stored value into a usable preference value.
 *
 * Total, and never throws: this runs over `.nlproj` contents, over a bundle assembled by an older
 * Studio, and over whatever the player's own storage happens to hold. A value that cannot be read
 * falls back to the engine default rather than propagating `undefined` into `game.preference`,
 * where it would silently mean "0 characters per second".
 */
export function normalizePlayerPreference(key: PlayerPreferenceKey, value: unknown): PlayerPreferenceValue {
    const spec = PLAYER_PREFERENCE_SPECS[key];
    switch (spec.kind) {
        case "boolean":
            return typeof value === "boolean" ? value : spec.defaultValue;
        case "number":
            return clampNumber(value, spec);
        case "enum":
            return spec.options.includes(value as VoiceEndMode) ? value as VoiceEndMode : spec.defaultValue;
    }
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a complete set.
 *
 * Dense on purpose, unlike the sparse lint config: a preference has no "unset" state at runtime -
 * the engine holds a value for every key from the moment the game is constructed - so the honest
 * representation of "the author did not choose" is "the engine's default", not a missing key.
 */
export function normalizePlayerPreferences(value: unknown): PlayerPreferences {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const normalized = {} as Record<PlayerPreferenceKey, PlayerPreferenceValue>;
    for (const key of PLAYER_PREFERENCE_KEYS) {
        normalized[key] = normalizePlayerPreference(key, record[key]);
    }
    return normalized as PlayerPreferences;
}

/** Whether a string names a preference this Studio knows. */
export function isPlayerPreferenceKey(key: unknown): key is PlayerPreferenceKey {
    return typeof key === "string" && (PLAYER_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/**
 * The keys the engine itself owns, i.e. everything but Studio's own.
 *
 * Used where a value is handed to `game.preference`: `skipReadText` travels in the same store (the
 * engine's `Preference` is a plain keyed map and carries it without complaint), but it is Studio
 * that acts on it, so anything reasoning about *engine* behaviour wants this list rather than the
 * full one.
 */
export const STUDIO_OWNED_PREFERENCE_KEYS: readonly PlayerPreferenceKey[] = [
    "skipReadText",
    // The engine reads this one from `game.config`, not from its preference store. It rides here
    // for the author-facing half - a default, a settings row, a blueprint pair - and the host
    // copies it into the config; see `preferenceRuntime`.
    "autoForwardDelay",
];

/**
 * Preferences that exist only while the game is running.
 *
 * `skipping` is "the skip run is going", the state a held skip key puts the game into. It is a
 * preference because that is the only surface an author can reach from a graph - the same `Get` /
 * `Set` pair, the same `On Preference Changed` head, the same host API as the fifteen above - and
 * a quick menu's Skip button, or a touch screen with no keyboard at all, has nothing else to bind.
 *
 * It is **deliberately outside** {@link PLAYER_PREFERENCE_KEYS}, and that placement is the whole
 * safety argument rather than a detail of it. Both halves of the preference plumbing enumerate that
 * list: the project file writes every key in it as an authored default, and the player's own store
 * saves and restores every key in it. A transient key listed there would be a row asking an author
 * to choose whether the game starts out skipping, and a player who quit while skipping would come
 * back to a game skipping itself. Neither is reachable from here.
 *
 * Seeded at construction so a graph reading it before anything has written one gets `false` rather
 * than nothing - `Get Skipping` is typed boolean and an absent value is not one.
 */
export const RUNTIME_PREFERENCE_KEYS = ["skipping"] as const;

export type RuntimePreferenceKey = typeof RUNTIME_PREFERENCE_KEYS[number];

/** What every session starts at. Applied when the game is constructed, and never written back. */
export const RUNTIME_PREFERENCE_DEFAULTS: Readonly<Record<RuntimePreferenceKey, boolean>> = {
    skipping: false,
};
