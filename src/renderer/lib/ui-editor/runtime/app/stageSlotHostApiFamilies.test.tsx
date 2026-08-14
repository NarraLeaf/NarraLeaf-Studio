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
import { useStageSlotSurfaceRuntime, type GameUiSlotHostOptions } from "./StageSlotSurfaceShell";
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
