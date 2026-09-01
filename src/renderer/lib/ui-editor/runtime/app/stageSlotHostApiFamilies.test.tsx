// @vitest-environment jsdom
/**
 * A Game UI slot surface builds its **own** blueprint host API, separate from the one the top-level
 * surfaces get, and a whole family of callbacks left off that build is silently dead.
 *
 * It happened twice. Sound first: a button-click sound in a dialogue box, a choice list or an NVL
 * surface did nothing at all - `sound.play` returned null and every transport node after it
 * addressed nothing, with no diagnostic anywhere. Then progress: Export/Import Progress answered
 * "progress cannot be written here" inside those same slots while working one surface above, which
 * reads like the feature refusing rather than the host missing.
 *
 * Both holes were invisible because both halves type-check: every option in these families is
 * optional by design (the in-editor story preview genuinely has neither audio nor a shell to write
 * a document). So the guard has to be that the options object the shell hands to
 * `createDevModeBlueprintHostApi` actually carries them.
 */
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type { CreateBlueprintHostApiRuntimeOptions } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { GameVoiceBundle } from "@shared/types/voice";
import { useStageSlotSurfaceRuntime, type GameUiSlotHostOptions } from "./StageSlotSurfaceShell";
import { stageSlotRuntimeScopeId } from "./stageSlots";
import type { SoundTransport } from "./soundTransport";

const capturedOptions: CreateBlueprintHostApiRuntimeOptions[] = [];

vi.mock("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge", async importOriginal => {
    const actual = await importOriginal<
        typeof import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge")
    >();
    return {
        ...actual,
        createDevModeBlueprintHostApi: (options: CreateBlueprintHostApiRuntimeOptions) => {
            capturedOptions.push(options);
            return actual.createDevModeBlueprintHostApi(options);
        },
    };
});

vi.mock("@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter", () => ({
    createDevModeBlueprintHostAdapter: () => ({ host: {} }),
}));

const TRACKS: ProjectAudioTrack[] = [
    { id: "sound", name: "SFX", parentId: null, volume: 1, loop: false, builtin: true },
];

function createSoundTransportStub(): SoundTransport {
    return {
        play: vi.fn(async () => null),
        stop: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        setVolume: vi.fn(async () => undefined),
        seek: vi.fn(async () => undefined),
        isPlaying: vi.fn(() => false),
        getTrackVolume: vi.fn(() => 1),
        setTrackVolume: vi.fn(async () => undefined),
        dispose: vi.fn(),
    };
}

const surface = {
    id: "dialog-surface",
    kind: "stageSurface",
    name: "Dialog",
    rootElementId: "root",
    designSize: { width: 1920, height: 1080 },
} as unknown as UIStageSurface;

const document_: UIDocument = { surfaces: [surface], elements: {} } as unknown as UIDocument;

function hostOptions(overrides: Partial<GameUiSlotHostOptions>): GameUiSlotHostOptions {
    const noop = () => undefined;
    return {
        sessionId: "session",
        core: {
            scopeBridge: {},
            debug: { emit: noop },
            executionManager: {},
        },
        bundle: { ui: { uidoc: document_ }, localization: undefined },
        rendererRegistry: {},
        lifecycleRef: { current: {} },
        makeStateAccessors: () => null,
        openSurfaceWithTransition: async () => undefined,
        goBackWithTransition: async () => undefined,
        quitApplication: async () => undefined,
        startStoryInGame: async () => undefined,
        writeSaveInGame: async () => undefined,
        loadSaveInGame: async () => undefined,
        deleteSaveInGame: async () => undefined,
        listSaveIds: async () => [],
        getSaveMetadata: async () => null,
        getSaveTimes: async () => null,
        getSavePreview: async () => null,
        writeAutoSaveInGame: async () => undefined,
        listAutoSaves: async () => [],
        getHistoryInGame: () => [],
        restoreHistoryInGame: async () => undefined,
        getCurrentNametag: () => null,
        getNotificationsInGame: () => [],
        getChoiceCountInGame: () => 0,
        isNvlModeInGame: () => false,
        selectChoiceInGame: async () => undefined,
        isInGame: () => true,
        quitGame: async () => undefined,
        nextInGame: async () => undefined,
        skipInGame: async () => undefined,
        showDialogInGame: async () => undefined,
        hideDialogInGame: async () => undefined,
        toggleDialogDisplayInGame: async () => undefined,
        setSentenceSpeedInGame: async () => undefined,
        getGamePreferenceInGame: () => 1,
        setGamePreferenceInGame: async () => undefined,
        setWidgetPatchesByScope: noop,
        widgetPatchesByScopeRef: { current: {} },
        widgetRuntimeStore: { subscribe: () => noop, get: () => undefined },
        ...overrides,
    } as unknown as GameUiSlotHostOptions;
}

function renderShell(overrides: Partial<GameUiSlotHostOptions>) {
    capturedOptions.length = 0;
    renderHook(() => useStageSlotSurfaceRuntime({
        options: hostOptions(overrides),
        surface,
        slotId: "dialog" as UIStageSlotId,
    }));
    return capturedOptions.at(-1)!;
}

const SOUND_CALLBACKS = [
    "onPlaySound",
    "onStopSound",
    "onPauseSound",
    "onResumeSound",
    "onSetSoundVolume",
    "onSeekSound",
    "onIsSoundPlaying",
    // The mixer half. Left off, a settings page opened as a Game UI overlay would read every
    // track at unity and write nowhere - a slider that visibly does nothing.
    "onGetTrackVolume",
    "onSetTrackVolume",
] as const;

describe("stage slot surface sound transport", () => {
    afterEach(cleanup);

    it("passes every sound callback through to the slot's host API", () => {
        const soundTransport = createSoundTransportStub();

        const options = renderShell({ soundTransport, audioTracks: TRACKS });

        for (const key of SOUND_CALLBACKS) {
            expect(options[key], `${key} missing from the slot host API`).toBeTypeOf("function");
        }
        expect(options.onPlaySound).toBe(soundTransport.play);
        expect(options.onStopSound).toBe(soundTransport.stop);
        expect(options.onIsSoundPlaying).toBe(soundTransport.isPlaying);
    });

    it("reaches the engine when a slot's graph plays a sound", async () => {
        const soundTransport = createSoundTransportStub();

        const options = renderShell({ soundTransport, audioTracks: TRACKS });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);
        await hostApi.sound.play({ assetId: "click", audioTrackId: "sound" });

        // Before the fix this resolved to null without ever reaching a transport.
        expect(soundTransport.play).toHaveBeenCalledWith({ assetId: "click", audioTrackId: "sound" });
    });

    it("carries the project's tracks so the slot's video widgets obey the mixer", () => {
        const options = renderShell({ soundTransport: createSoundTransportStub(), audioTracks: TRACKS });

        expect(options.audioTracks).toBe(TRACKS);
    });

    it("still builds a host API on a host that backs no audio", () => {
        // The in-editor story preview. The family's documented degrade is silence, not a crash.
        const options = renderShell({});

        expect(options.onPlaySound).toBeUndefined();
        expect(options.onGetGamePreference).toBeTypeOf("function");
    });
});

describe("stage slot surface progress carry", () => {
    afterEach(cleanup);

    it("passes both progress callbacks through to the slot's host API", () => {
        const exportProgressInGame = vi.fn(async () => ({ outcome: "written" as const, error: "" }));
        const importProgressInGame = vi.fn(async () => ({ outcome: "missing" as const, sceneId: "", error: "" }));

        const options = renderShell({ exportProgressInGame, importProgressInGame });

        expect(options.onExportProgress).toBe(exportProgressInGame);
        expect(options.onImportProgress).toBe(importProgressInGame);
    });

    it("reaches the shell when a slot's graph carries progress", async () => {
        // A title screen is exactly the kind of surface an author builds out of Game UI slots, so
        // this is the path the feature is for - not an edge case.
        const exportProgressInGame = vi.fn(async () => ({ outcome: "written" as const, error: "" }));
        const importProgressInGame = vi.fn(async () => ({ outcome: "found" as const, sceneId: "chapter-2", error: "" }));

        const options = renderShell({ exportProgressInGame, importProgressInGame });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        // Before the fix both of these refused without ever reaching a shell.
        await expect(hostApi.progress.export()).resolves.toEqual({ outcome: "written", error: "" });
        await expect(hostApi.progress.import()).resolves.toEqual({
            outcome: "found",
            sceneId: "chapter-2",
            error: "",
        });
        expect(exportProgressInGame).toHaveBeenCalled();
        expect(importProgressInGame).toHaveBeenCalled();
    });

    it("refuses on a host with nowhere to write, rather than crashing", async () => {
        const options = renderShell({});
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        await expect(hostApi.progress.export()).resolves.toMatchObject({ outcome: "failed" });
    });
});

describe("stage slot surface language carry", () => {
    afterEach(cleanup);

    it("passes the language hook through to the slot's host API", () => {
        // A language picker belongs to a quick menu as often as to a settings page, and a quick
        // menu is a Game UI slot surface. Without this the same control would restart the game from
        // one surface and silently leave a running playthrough half-translated from the other.
        const localeChangedInGame = vi.fn(async () => undefined);

        const options = renderShell({ localeChangedInGame });

        expect(options.onLocaleChanged).toBe(localeChangedInGame);
    });

    it("still changes the language on a host that backs no restart", () => {
        const options = renderShell({});

        expect(options.onLocaleChanged).toBeUndefined();
    });
});

describe("stage slot surface voice carry", () => {
    afterEach(cleanup);

    /**
     * The dub languages of the running game. Unlike every hole before it this one is not a
     * callback but a plain data field, which is why the key-set comparison in
     * `stageSlotHostForwarding` - reading only keys spelled `onSomething` - passed while it was
     * missing. It also failed louder than the rest: `voice.listLocales()` answered empty, so every
     * voice node threw "This project has no voice languages configured" on a dialogue box, a
     * choice list, an NVL surface or the quick menu, blaming the author's project for a field the
     * host had not handed over.
     */
    const VOICE: GameVoiceBundle = {
        voicedLocales: [
            { code: "ja", displayName: "日本語" },
            { code: "en", displayName: "English" },
        ],
        tables: {},
    };

    function withVoice(rest: Partial<GameUiSlotHostOptions> = {}): Partial<GameUiSlotHostOptions> {
        return {
            ...rest,
            bundle: { ui: { uidoc: document_ }, localization: undefined, voice: VOICE },
        } as unknown as Partial<GameUiSlotHostOptions>;
    }

    it("passes the dub languages and both playback callbacks to the slot's host API", () => {
        const playVoiceUnit = vi.fn(async () => true);
        const playChoiceVoiceUnit = vi.fn(async () => true);

        const options = renderShell(withVoice({ playVoiceUnit, playChoiceVoiceUnit }));

        expect(options.voiceConfig).toBe(VOICE);
        expect(options.onPlayVoice).toBe(playVoiceUnit);
        expect(options.onPlayChoiceVoice).toBe(playChoiceVoiceUnit);
    });

    it("lists the project's dub languages from inside a slot", async () => {
        const options = renderShell(withVoice());
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        // Before the fix this was empty, and empty is exactly what the voice nodes raise on.
        expect(hostApi.voice.listLocales().map(entry => entry.code)).toEqual(["ja", "en"]);
    });

    it("answers empty on a project with no voice set up, rather than throwing", async () => {
        // The documented degrade, and the reason the field is optional: a project that was never
        // dubbed has no languages to list, and the node reports that as the author's own state.
        const options = renderShell({});
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        expect(options.voiceConfig).toBeNull();
        expect(hostApi.voice.listLocales()).toEqual([]);
    });
});

describe("stage slot surface rebuilt drawing", () => {
    afterEach(cleanup);

    /**
     * A slot surface outlives none of its own writes, but its drawing outlives it.
     *
     * The engine gives a dialog box a new React key whenever the gap between two lines outlives its
     * replacement grace, so the whole slot surface is torn down and rebuilt mid-scene; the patches
     * the old one painted are kept by the host, keyed by this scope, so the box comes back looking
     * as it did. Every widget setter writes nothing when the value it is given already matches what
     * the drawing shows, so a host API rebuilt with an empty mirror dropped exactly the writes that
     * put an element *back* to its authored value - and the previous speaker's avatar stayed on the
     * narration line that replaced them.
     */
    it("hands the host API what this scope is already showing", () => {
        const runtimeScopeId = stageSlotRuntimeScopeId("session", "dialog" as UIStageSlotId, surface.id, 0);
        const painted = { avatar: { props: { imageFill: { mode: "cover", assetId: "avatar-a" } } } };

        const options = renderShell({
            widgetPatchesByScopeRef: { current: { [runtimeScopeId]: painted } },
        } as unknown as Partial<GameUiSlotHostOptions>);

        expect(options.initialWidgetPatches).toBe(painted);
    });

    it("hands nothing to a scope nothing has drawn on", () => {
        const options = renderShell({});

        expect(options.initialWidgetPatches).toBeUndefined();
    });
});

describe("stage slot surface saved variables", () => {
    afterEach(cleanup);

    it("passes both saved-variable callbacks through to the slot's host API", () => {
        // The third time this family of holes appeared, and the one most visibly wrong: the screens
        // that show a saved variable while the story plays - a HUD, an affection meter, a status
        // strip in the quick menu - are the on-stage ones. MEASURED before the fix, on a running
        // game: the same two nodes answered `v=7 f=true` on a page and `v= f=false` on the quick
        // menu, and the write there was refused with "game runtime is not available".
        const getSavedVariableInGame = vi.fn(() => ({ value: 7, found: true }));
        const setSavedVariableInGame = vi.fn();

        const options = renderShell({ getSavedVariableInGame, setSavedVariableInGame });

        expect(options.onGetSavedVariable).toBe(getSavedVariableInGame);
        expect(options.onSetSavedVariable).toBe(setSavedVariableInGame);
    });

    it("reads and writes the playthrough from inside a slot", async () => {
        const store = new Map<string, unknown>([["affection", 7]]);
        const options = renderShell({
            getSavedVariableInGame: id => (store.has(id) ? { value: store.get(id), found: true } : { value: null, found: false }),
            setSavedVariableInGame: (id, value) => { store.set(id, value); },
        });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        expect(hostApi.game.getSavedVariable("affection")).toEqual({ value: 7, found: true });
        hostApi.game.setSavedVariable("affection", 42);
        expect(hostApi.game.getSavedVariable("affection")).toEqual({ value: 42, found: true });
    });
});
