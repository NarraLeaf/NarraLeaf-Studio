/** Bumped when BlueprintHostApiContract shape changes incompatibly */
export const BLUEPRINT_HOST_API_CONTRACT_VERSION = 30 as const;

/** Global runtime state key mirrored from the active NarraLeaf dialog hook. */
export const BLUEPRINT_GAME_NAMETAG_STATE_KEY = "game.dialog.nametag" as const;

/**
 * Global runtime state key holding the speaking character's authored accent colour, as a
 * {@link BlueprintRGBAColor}.
 *
 * Written on the same beat as the nametag (that write is also the value-graph re-evaluation clock),
 * so a nametag widget that tints itself from this key repaints with the line it belongs to. Null
 * when nobody is speaking, when the narrator is, or when the character has no colour set - readers
 * fall back to the default opaque white every colour pin uses.
 */
export const BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY = "game.dialog.color" as const;

/**
 * Global runtime state key holding the *id* of the speaking character, staged by the host when the
 * speaker changes.
 *
 * Exists because the nametag cannot be used as an identity. The engine reports the authored
 * (source-language) name, hosts translate it before publishing it, and two characters may share a
 * display name - so anything that needs to look a speaker up in the character table needs this
 * instead. Null when nobody is speaking or the speaker is not a project character (a `/temp` name).
 *
 * Written by the host on the speaker-change callback and only ever *read* on the dialog beat, which
 * is what lets a narrator line blank the derived colour without destroying who spoke last.
 */
export const BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY = "game.dialog.characterId" as const;

/**
 * Global runtime state key holding the project's character table as
 * `BlueprintCharacterInfo[]` (see `./characterInfo`).
 *
 * Mirrored once per bundle rather than fetched per read: the table already ships inside the Dev Mode
 * bundle, it does not change while a game runs, and going through global state means every host that
 * shares a scope bridge - the app surfaces, each Game UI slot surface, the workspace story preview -
 * gets `Get Character` for free without its own callback wiring.
 */
export const BLUEPRINT_GAME_CHARACTERS_STATE_KEY = "game.characters" as const;

/**
 * Global runtime state key holding the speaking character's dialog avatar, as an asset id.
 *
 * Mirrored from the engine's own avatar resolution (`useAvatar`), which reads the live portrait
 * element - so it already accounts for the differential the character is currently wearing, and
 * for undo, load and skip. Null when nobody is speaking, when the narrator is, or when the current
 * differential resolves no avatar.
 */
export const BLUEPRINT_GAME_SPEAKER_AVATAR_STATE_KEY = "game.dialog.avatar" as const;

/** Global runtime state key mirrored from the NarraLeaf notification slot bridge. */
export const BLUEPRINT_GAME_NOTIFICATIONS_STATE_KEY = "game.notifications" as const;

/** Global runtime state key mirrored from the NarraLeaf choice (menu) slot bridge. */
export const BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY = "game.choice.count" as const;

/** Global runtime state key mirrored from the NarraLeaf NVL slot bridge. */
export const BLUEPRINT_GAME_NVL_MODE_STATE_KEY = "game.nvl.active" as const;

/**
 * Global runtime state key mirrored from the Studio text-read tracker:
 * true while a dialog line is on screen AND its message is marked read
 * (previously seen, or the current display finished).
 */
export const BLUEPRINT_GAME_TEXT_READ_STATE_KEY = "game.dialog.textRead" as const;

/**
 * Project-persistence key holding the read text UUIDs (string[]). Shared so
 * hosts without a live tracker (e.g. a settings page before any game starts)
 * can still wipe the record.
 */
export const BLUEPRINT_TEXT_READ_PERSISTENCE_KEY = "nlr.textRead" as const;

export type BlueprintHostApiContractVersion = typeof BLUEPRINT_HOST_API_CONTRACT_VERSION;

/**
 * Blueprint System - host API contract surface.
 * Visual and TypeScript blueprints share this capability tree; implementations live in runtime (M3+).
 *
 * - purity: whether the operation is side-effect free from the blueprint semantics perspective
 * - callableFromBinding: if false, must not be invoked from field/binding evaluation
 * - async: if true, callers should treat the operation as Promise-capable
 */

export type BlueprintHostApiPurity = "pure" | "effectful";

export type BlueprintHostCapabilityContract = {
    /** Human-readable capability id, stable across frontends */
    capabilityId: string;
    purity: BlueprintHostApiPurity;
    /** Only pure reads/compute may run inside binding evaluation */
    callableFromBinding: boolean;
    async: boolean;
    /** Loose input/output shapes; M3 implementations narrow */
    input?: Record<string, unknown>;
    output?: unknown;
};

export type BlueprintHostApiFamily = Record<string, BlueprintHostCapabilityContract>;

/**
 * Host API families (see blueprint-system-milestones §5.5).
 * Values are capability name -> contract metadata (not runtime functions).
 */
export type BlueprintHostApiContract = {
    navigation: BlueprintHostApiFamily;
    widget: BlueprintHostApiFamily;
    state: BlueprintHostApiFamily;
    persistence: BlueprintHostApiFamily;
    frame: BlueprintHostApiFamily;
    game: BlueprintHostApiFamily;
    sound: BlueprintHostApiFamily;
    devtools: BlueprintHostApiFamily;
};

/**
 * Canonical M1 capability ids and defaults. Runtime adapters map to these names in M3+.
 */
export const BLUEPRINT_HOST_API_M1_CAPABILITIES: BlueprintHostApiContract = {
    navigation: {
        openSurface: {
            capabilityId: "navigation.openSurface",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { surfaceId: "", props: {} },
            output: null,
        },
        getPageProps: {
            capabilityId: "navigation.getPageProps",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: {},
        },
        closeLayer: {
            capabilityId: "navigation.closeLayer",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        quitApplication: {
            capabilityId: "navigation.quitApplication",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        getFullscreen: {
            capabilityId: "navigation.getFullscreen",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: false,
        },
        setFullscreen: {
            capabilityId: "navigation.setFullscreen",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { fullscreen: false },
            output: null,
        },
    },
    widget: {
        setVisible: {
            capabilityId: "widget.setVisible",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { elementId: "", visible: true },
            output: null,
        },
        setEnabled: {
            capabilityId: "widget.setEnabled",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { elementId: "", enabled: true },
            output: null,
        },
        setVariant: {
            capabilityId: "widget.setVariant",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", variantId: "" },
            output: null,
        },
        getTextProperties: {
            capabilityId: "widget.getTextProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setTextProperties: {
            capabilityId: "widget.setTextProperties",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", patch: {} },
            output: null,
        },
        getSliderProperties: {
            capabilityId: "widget.getSliderProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setSliderProperties: {
            capabilityId: "widget.setSliderProperties",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", patch: {} },
            output: null,
        },
        getTextInputProperties: {
            capabilityId: "widget.getTextInputProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setTextInputProperties: {
            capabilityId: "widget.setTextInputProperties",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", patch: {} },
            output: null,
        },
    },
    state: {
        get: {
            capabilityId: "state.get",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { scope: "", key: "" },
            output: null,
        },
        set: {
            capabilityId: "state.set",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { scope: "", key: "", value: null },
            output: null,
        },
    },
    persistence: {
        get: {
            capabilityId: "persistence.get",
            purity: "pure",
            callableFromBinding: true,
            async: true,
            input: { key: "" },
            output: null,
        },
        set: {
            capabilityId: "persistence.set",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { key: "", value: null },
            output: null,
        },
    },
    frame: {
        getParam: {
            capabilityId: "frame.getParam",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { key: "" },
            output: null,
        },
        emit: {
            capabilityId: "frame.emit",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { event: "", data: null },
            output: null,
        },
    },
    game: {
        startStory: {
            capabilityId: "game.startStory",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { storyId: "", sceneId: "" },
            output: null,
        },
        isInGame: {
            capabilityId: "game.isInGame",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
        },
        isGameOverlay: {
            capabilityId: "game.isGameOverlay",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
        },
        quit: {
            capabilityId: "game.quit",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { surfaceId: "" },
            output: null,
        },
        writeSave: {
            capabilityId: "game.writeSave",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "", metadata: null, screenshot: false },
            output: null,
        },
        loadSave: {
            capabilityId: "game.loadSave",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        deleteSave: {
            capabilityId: "game.deleteSave",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        listSaveIds: {
            capabilityId: "game.listSaveIds",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: [],
        },
        getSaveMetadata: {
            capabilityId: "game.getSaveMetadata",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        getSavePreview: {
            capabilityId: "game.getSavePreview",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        writeAutoSave: {
            capabilityId: "game.writeAutoSave",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        listAutoSaves: {
            capabilityId: "game.listAutoSaves",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: [],
        },
        getHistory: {
            capabilityId: "game.getHistory",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: [],
        },
        restoreHistory: {
            capabilityId: "game.restoreHistory",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        getNametag: {
            capabilityId: "game.getNametag",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: null,
        },
        getSpeakerAvatar: {
            capabilityId: "game.getSpeakerAvatar",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: null,
        },
        getSpeakerColor: {
            capabilityId: "game.getSpeakerColor",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: null,
        },
        getCharacter: {
            capabilityId: "game.getCharacter",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { characterId: "" },
            output: null,
        },
        getNotifications: {
            capabilityId: "game.getNotifications",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: [],
        },
        getChoiceCount: {
            capabilityId: "game.getChoiceCount",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: 0,
        },
        isNvlMode: {
            capabilityId: "game.isNvlMode",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
        },
        isCurrentTextRead: {
            capabilityId: "game.isCurrentTextRead",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
        },
        isTextRead: {
            capabilityId: "game.isTextRead",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { textId: "" },
            output: false,
        },
        clearTextRead: {
            capabilityId: "game.clearTextRead",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        choose: {
            capabilityId: "game.choose",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { index: 0 },
            output: null,
        },
        next: {
            capabilityId: "game.next",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        skip: {
            capabilityId: "game.skip",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        showDialog: {
            capabilityId: "game.showDialog",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        hideDialog: {
            capabilityId: "game.hideDialog",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        toggleDialogDisplay: {
            capabilityId: "game.toggleDialogDisplay",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        setSentenceSpeed: {
            capabilityId: "game.setSentenceSpeed",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { cps: 10 },
            output: null,
        },
        getPreference: {
            capabilityId: "game.getPreference",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { key: "" },
            output: null,
        },
        setPreference: {
            capabilityId: "game.setPreference",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { key: "", value: null },
            output: null,
        },
    },
    /**
     * Audio playback for authored UI, routed through the engine's own audio
     * path (`LiveGame.playSound`) rather than a host-side Web Audio backend.
     *
     * Going through the engine is the whole point: it owns the per-channel
     * mixer, so a clip played on the `bgm` channel obeys the player's BGM
     * volume, the master volume and mute for free. A host that played audio
     * itself would produce sound the player's settings cannot touch.
     *
     * Needed far beyond the gallery - before this family, an authored title
     * screen could not play a button click.
     */
    sound: {
        play: {
            capabilityId: "sound.play",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { assetId: "", channel: "sound", loop: false, volume: 1 },
            output: { kind: "soundHandle", id: "" },
        },
        stop: {
            capabilityId: "sound.stop",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: null, fadeMs: 0 },
            output: null,
        },
        pause: {
            capabilityId: "sound.pause",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: null },
            output: null,
        },
        resume: {
            capabilityId: "sound.resume",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: null },
            output: null,
        },
        setVolume: {
            capabilityId: "sound.setVolume",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: null, volume: 1, fadeMs: 0 },
            output: null,
        },
        seek: {
            capabilityId: "sound.seek",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: null, timeMs: 0 },
            output: null,
        },
        isPlaying: {
            capabilityId: "sound.isPlaying",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { handle: null },
            output: false,
        },
    },
    devtools: {
        log: {
            capabilityId: "devtools.log",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { level: "info", message: "" },
            output: null,
        },
    },
};
