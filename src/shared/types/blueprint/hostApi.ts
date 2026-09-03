/** Bumped when BlueprintHostApiContract shape changes incompatibly */
export const BLUEPRINT_HOST_API_CONTRACT_VERSION = 39 as const;

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

/**
 * Global runtime state key holding whether the line on screen has finished revealing and the dialog
 * is now waiting for the player.
 *
 * The state a click-to-continue indicator is drawn under, and the reason this family of keys exists
 * at all: the engine has always known it, and until it was published here a widget could only be on
 * for the whole of a line or off for the whole of one.
 *
 * Written on the dialog beat next to the nametag, which is also the beat that re-evaluates every
 * value graph - so the frame the indicator appears on is the frame the line finished. False, not
 * null, when no line is on screen: a widget bound to it must lay out before any game exists.
 */
export const BLUEPRINT_GAME_DIALOG_WAITING_STATE_KEY = "game.dialog.waiting" as const;

/**
 * Global runtime state key holding the current line's text.
 *
 * The whole line, not the part revealed so far. The engine evaluates a line's words when it mounts
 * and reveals a prefix of that, so this value is settled before the first character appears - which
 * is what lets a widget size itself for the line it is about to show rather than one character at a
 * time. Empty string when no line is on screen.
 */
export const BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY = "game.dialog.text" as const;

/**
 * Global runtime state key holding whether the current line has no speaker.
 *
 * Distinct from a null nametag, which is also what a character with a blank name reports, and which
 * a widget cannot test before it has a name at all. False when no line is on screen.
 */
export const BLUEPRINT_GAME_DIALOG_NARRATOR_STATE_KEY = "game.dialog.narrator" as const;

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

/**
 * Project-persistence key holding the ids of the endings the player has reached (string[]).
 *
 * The **project** store, not the save file, and that is the whole decision. An endings screen exists
 * to say what this player has ever seen: a record kept inside a save would rewind the moment they
 * loaded an earlier one, so a gallery would lock entries back up in front of them and a "5 of 8"
 * count would go down. The visited record next door (`__nlr_story_visited__`) is deliberately the
 * other way round, because it answers a different question - "have I been down this route in *this*
 * playthrough" - and has to rewind.
 *
 * Ids are `ending` rows' block ids, so renaming an ending keeps every unlock.
 */
export const BLUEPRINT_ENDINGS_PERSISTENCE_KEY = "nlr.endings" as const;

/**
 * Project-persistence key holding the title's total playtime in seconds (number).
 *
 * Title-level rather than per-save, so it is deliberately outside every save file: loading an old
 * save does not un-play the hours that led to it. The per-save reading lives on the save record
 * instead (`playtimeSeconds`), where a save list can read it without deserializing a game.
 */
export const BLUEPRINT_PLAYTIME_TOTAL_PERSISTENCE_KEY = "nlr.playtimeTotal" as const;

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
    layers: BlueprintHostApiFamily;
    widget: BlueprintHostApiFamily;
    state: BlueprintHostApiFamily;
    persistence: BlueprintHostApiFamily;
    frame: BlueprintHostApiFamily;
    game: BlueprintHostApiFamily;
    sound: BlueprintHostApiFamily;
    network: BlueprintHostApiFamily;
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
        pageBack: {
            capabilityId: "navigation.pageBack",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        clearPages: {
            capabilityId: "navigation.clearPages",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: null,
        },
        clearGameOverlay: {
            capabilityId: "navigation.clearGameOverlay",
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
        /**
         * The window's size, as a multiple of the size the game is drawn at.
         *
         * The list comes first and the pair below act on it: the sizes a build offers are the
         * author's answer in `app.window`, and a shell with no window of its own to size answers
         * with an empty list - so a configuration screen built from it draws no size row there,
         * rather than a row that cannot work.
         */
        getWindowScaleOptions: {
            capabilityId: "navigation.getWindowScaleOptions",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: [] as number[],
        },
        getWindowScale: {
            capabilityId: "navigation.getWindowScale",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: 1,
        },
        setWindowScale: {
            capabilityId: "navigation.setWindowScale",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { scale: 1 },
            output: null,
        },
        /** The same size in pixels, for a game whose number comes from somewhere else. */
        getWindowSize: {
            capabilityId: "navigation.getWindowSize",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: { width: 0, height: 0 },
        },
        setWindowSize: {
            capabilityId: "navigation.setWindowSize",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { width: 0, height: 0 },
            output: null,
        },
        /**
         * Hand one web address to the player's own browser - a store page, a patch note, a support
         * form.
         *
         * In `navigation` rather than in `network`, and not gated on the project's Allow HTTP
         * setting: nothing is requested and nothing comes back into the game, so a build with the
         * network switched off may still open a page, and one with it switched on gains nothing
         * here. Conflating the two would make an author turn the network on to link to their own
         * store.
         *
         * **Only addresses the build's variant declared are reachable.** The check is made by the
         * process that would perform the act (see `@shared/types/blueprint/externalLink`), never by
         * the caller, and a refusal is a result the graph branches on rather than an exception.
         */
        openExternal: {
            capabilityId: "navigation.openExternal",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { url: "" },
            output: { outcome: "opened", error: null },
        },
        /**
         * Write a picture of the frame the player is looking at.
         *
         * Where it goes is the shell's answer and never the caller's: a game that could name the
         * file could write anywhere the player's account can. Desktop only - a page in a browser
         * has no window to capture from outside it and nowhere to leave a file - and the absence is
         * reported as a `failed` result the graph branches on, not as an exception.
         */
        saveScreenshot: {
            capabilityId: "navigation.saveScreenshot",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: { outcome: "saved", path: null, error: null },
        },
        /** Show the player where those pictures are. Beside the one above, and absent beside it. */
        openScreenshotsFolder: {
            capabilityId: "navigation.openScreenshotsFolder",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: { outcome: "opened", path: null, error: null },
        },
        /**
         * Whether this game's window is the one the player is working in.
         *
         * A read, but an asynchronous one: on every desktop shell the window belongs to another
         * process, and the answer a renderer could give on its own is a second, quietly different
         * one. `On Window Focus Changed` is the same fact arriving rather than being asked for.
         */
        isWindowFocused: {
            capabilityId: "navigation.isWindowFocused",
            purity: "pure",
            callableFromBinding: false,
            async: true,
            input: {},
            output: true,
        },
    },
    /**
     * Surfaces stacked over the page lane, rather than replacing it.
     *
     * Separate from `navigation` because none of it is navigation: a layer arrives over whatever is
     * already on screen and leaves without revealing anything new, so the page stack is untouched
     * from the moment one mounts to the moment it goes. Folding these into `navigation` would have
     * put "replace the screen" and "cover the screen" behind the same six words.
     *
     * Three properties are enforced by the host rather than by the nodes:
     *
     *  - **A handle is minted by `show` and is the only way to name a layer.** There are no layer
     *    names and no z indices; stacking order is mount order, which is what keeps an author from
     *    building a screen that depends on one.
     *  - **Every layer belongs to the scope that showed it and dies with it.** A page that navigates
     *    away takes its layers, and so does a layer that closes with layers of its own. Forgetting
     *    to hide one cannot leave an orphan on screen.
     *  - **A `group` is mutually exclusive.** A second layer named into an occupied group waits for
     *    the first one's exit to finish rather than stacking on top of it.
     */
    layers: {
        show: {
            capabilityId: "layers.show",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { surfaceId: "", props: {}, modal: false, dismissible: true, group: null },
            output: "",
        },
        hide: {
            capabilityId: "layers.hide",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: "" },
            output: null,
        },
        hideGroup: {
            capabilityId: "layers.hideGroup",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { group: "" },
            output: null,
        },
        wait: {
            capabilityId: "layers.wait",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { handle: "" },
            output: null,
        },
        closeSelf: {
            capabilityId: "layers.closeSelf",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { result: null },
            output: null,
        },
        isMounted: {
            capabilityId: "layers.isMounted",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { handle: "" },
            output: false,
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
        getSwitchProperties: {
            capabilityId: "widget.getSwitchProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setSwitchProperties: {
            capabilityId: "widget.setSwitchProperties",
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
        /**
         * The running playthrough's playtime, in seconds.
         *
         * Synchronous and binding-callable because it reads a counter this process already holds -
         * the same reason `isInGame` is. Note that a binding re-evaluates when something re-renders,
         * never on a clock: a save screen reading this when it opens is right, and a HUD that has to
         * tick needs `On Playtime Tick` to drive the re-render.
         */
        getPlaytime: {
            capabilityId: "game.getPlaytime",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: 0,
        },
        /** Seconds ever spent in this project, across every playthrough. */
        getTotalPlaytime: {
            capabilityId: "game.getTotalPlaytime",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: 0,
        },
        /**
         * The playtime recorded on a stored save. Reads the save store, so unlike the two above it
         * is asynchronous and not callable from a binding.
         */
        getSavePlaytime: {
            capabilityId: "game.getSavePlaytime",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
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
            // True when the save was applied. A refusal is an answer rather than a throw: the node
            // has a `Failed` pin, and the player and the author have already been told.
            output: false,
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
        getSaveTimes: {
            capabilityId: "game.getSaveTimes",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        getSaveLine: {
            capabilityId: "game.getSaveLine",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { id: "" },
            output: null,
        },
        getSaveStory: {
            capabilityId: "game.getSaveStory",
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
        isDialogWaiting: {
            capabilityId: "game.isDialogWaiting",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
        },
        getDialogText: {
            capabilityId: "game.getDialogText",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: "",
        },
        isNarrator: {
            capabilityId: "game.isNarrator",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: false,
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
        /**
         * One saved variable's current value, read out of the running playthrough.
         *
         * The one piece of per-save state a Game UI screen can reach. Persistent variables are
         * app-level and shared by every save file, which is the right lifetime for "has this player
         * ever seen this ending" and the wrong one for anything a save is supposed to remember - so
         * a screen that shows where *this* playthrough stands had nothing to read until now.
         *
         * Read-only on purpose. A screen that wrote a saved variable would be writing story state
         * from outside the story: it would race the row that owns the variable, it is not on the
         * action stack so undo would not take it back, and a save written a moment later would keep
         * it while a load would not. Writing stays where the writes are sequenced - the story.
         *
         * `found` is what makes the read safe to put on a title screen. There is no playthrough
         * there, so there is no saved namespace either, and a bare value would have to be a lie in
         * one direction or the other: `null` reads as "the flag is off" and the default reads as
         * "the run has not set it yet". Both answers are wrong before a run exists, so the caller is
         * told which it got.
         *
         * Scene variables are deliberately absent. They exist only while their scene is the active
         * one, so a screen reading one would be asking about state that comes and goes underneath
         * it - and the screens that want it are the on-stage ones, which the story can feed through
         * a saved variable it controls.
         */
        getSavedVariable: {
            capabilityId: "game.getSavedVariable",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { variableId: "" },
            output: { value: null, found: false },
        },
        /**
         * Write one saved variable of the running playthrough.
         *
         * The other half of {@link getSavedVariable}, and it carries two consequences the read does
         * not, both of which are the price of the screen being outside the story rather than a
         * defect to fix here:
         *
         * - **Undo does not take it back.** The story's undo restores a per-row snapshot of the
         *   playthrough; a write made from a screen happened between rows, so undoing to the row
         *   before it rewinds everything except this.
         * - **The story is not told.** A row that reads the variable afterwards sees the new value,
         *   but nothing re-runs on the strength of it - the line already on screen stays as it is.
         *
         * So this is for state a SCREEN owns and the story reads (which destination the player
         * picked on a map, which loadout they chose), not for reaching in and correcting the story's
         * own bookkeeping.
         *
         * Refuses rather than reports when there is no playthrough, which is the opposite of the
         * read next door and for the opposite reason: a read has to answer while a title screen
         * lays out, whereas a write is an act a player asked for, and one that silently does
         * nothing is the worst outcome a button can have.
         */
        setSavedVariable: {
            capabilityId: "game.setSavedVariable",
            purity: "effectful",
            // A binding re-evaluates whenever anything it reads changes; a write inside one would
            // feed itself.
            callableFromBinding: false,
            // Synchronous for the reason `clearVisited` is: the value lands in the live `Storable`,
            // not in host persistence, so there is nothing to await.
            async: false,
            input: { variableId: "", value: null },
            output: null,
        },
        isSceneVisited: {
            capabilityId: "game.isSceneVisited",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { sceneId: "" },
            output: false,
        },
        isOptionPicked: {
            capabilityId: "game.isOptionPicked",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { optionId: "" },
            output: false,
        },
        clearVisited: {
            capabilityId: "game.clearVisited",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: {},
            output: null,
        },
        isEndingReached: {
            capabilityId: "game.isEndingReached",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { endingId: "" },
            output: false,
        },
        listEndings: {
            capabilityId: "game.listEndings",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { storyId: "" },
            output: [],
        },
        clearEndingState: {
            capabilityId: "game.clearEndingState",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { endingId: "" },
            output: null,
        },
        clearEndings: {
            capabilityId: "game.clearEndings",
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
            // `audioTrackId` replaced the old `channel`: the track names the bus *and* supplies the
            // gain and the fade/loop defaults, so the three overrides below are all nullable - unset
            // means "whatever the track says", which is not the same request as an explicit 0.
            input: { assetId: "", audioTrackId: null, loop: null, volume: null, fadeInMs: null },
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
        /**
         * For host-owned media elements (the `nl.video` widget's `<video>`), which sit outside the
         * engine's audio graph and would otherwise obey no player volume at all. Pure reads, so
         * both are callable from a binding.
         */
        resolveElementVolume: {
            capabilityId: "sound.resolveElementVolume",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { audioTrackId: null, volume: null },
            output: 1,
        },
        subscribeMixerChanges: {
            capabilityId: "sound.subscribeMixerChanges",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: {},
            output: null,
        },
    },
    /**
     * HTTP for authored screens: an online notice board, a patch note, a leaderboard.
     *
     * Three properties of this family are load-bearing and are enforced by the host, not by the
     * node:
     *
     *  - **The project's Allow HTTP setting gates it.** The request is issued from the main process,
     *    which sits outside the CSP and `webRequest` cage that confines the renderer, so the cage
     *    cannot be what stops it. A host that skipped this check would hand a project that switched
     *    the network off a working network.
     *  - **Only `http:` and `https:` are reachable.** Any other scheme is refused before a request is
     *    made, which is what keeps `file:` out and this node from being a local file reader.
     *  - **The response is bounded.** A body over the cap is refused rather than truncated: half a
     *    JSON document parses into a different error than the one that actually happened.
     *
     * Only the request is a host capability. The body it returns is held in the execution's own
     * `blueprintLocals`, so the reader nodes need nothing from the host - and a response is
     * unreachable from any other execution without anyone having to remember to free it.
     */
    network: {
        fetch: {
            capabilityId: "network.fetch",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { url: "", method: "GET", headers: null, body: null, timeoutMs: null },
            output: { outcome: "success", status: 0, body: null, error: null },
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
