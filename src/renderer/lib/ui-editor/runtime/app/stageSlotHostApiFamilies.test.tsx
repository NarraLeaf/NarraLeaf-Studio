// @vitest-environment jsdom
/**
 * A Game UI slot surface's host API has to carry what the game can do, all the way to the nodes.
 *
 * Whole families used to be missing from it. Sound first: a button-click sound in a dialogue box, a
 * choice list or an NVL surface did nothing at all - `sound.play` returned null and every transport
 * node after it addressed nothing, with no diagnostic anywhere. Then progress: Export/Import
 * Progress answered "progress cannot be written here" inside those same slots while working one
 * surface above, which reads like the feature refusing rather than the host missing. Then the saved
 * variables, then the dub languages.
 *
 * Every hole was invisible because both halves type-check: every option in these families is
 * optional by design (the in-editor story preview genuinely has neither audio nor a shell to write
 * a document), so a name left out reads exactly like a host that cannot do the thing.
 *
 * What that took is no longer a forwarding list in the shell - `gameHostApiOptions` builds every
 * host of a game from one set of capabilities, and leaving a name out of it does not compile. So
 * what this file still checks is the half a type cannot: that a capability handed to a slot
 * surface **arrives at the nodes as a working value** - that `sound.play` reaches a transport,
 * `progress.export` reaches a shell, `voice.listLocales()` lists what the project is dubbed into,
 * and a rebuilt slot starts from the drawing the old one left behind. Those are properties of the
 * bridge and the builder together, and the way to see them is to run both.
 *
 * Voice is the worst of them to meet, and worth the extra line: with the dub languages missing the
 * bridge reports the game as having none, so `Set Voice Language` throws "This project has no voice
 * languages configured" - an error that names the author's project settings for a field the host
 * simply never handed over, and that no amount of editing those settings can fix. It also shows a
 * family can arrive half-wired: `onPlayVoice` and `onPlayChoiceVoice` were forwarded all along, and
 * only `voiceConfig` - the data half - was missing.
 */
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type { CreateBlueprintHostApiRuntimeOptions } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { GameVoiceBundle } from "@shared/types/voice";
import { useStageSlotSurfaceRuntime, type GameUiSlotHostOptions } from "./StageSlotSurfaceShell";
import type { GameHostCapabilities } from "./gameHostApiOptions";
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

/** The nine sound options a host with a transport fills in, as a game's capabilities would. */
function soundCapabilities(transport: SoundTransport): Partial<GameHostCapabilities> {
    return {
        onPlaySound: transport.play,
        onStopSound: transport.stop,
        onPauseSound: transport.pause,
        onResumeSound: transport.resume,
        onSetSoundVolume: transport.setVolume,
        onSeekSound: transport.seek,
        onIsSoundPlaying: transport.isPlaying,
        onGetTrackVolume: transport.getTrackVolume,
        onSetTrackVolume: transport.setTrackVolume,
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

/**
 * A game that can do nothing, as the base every case adds one family to.
 *
 * Cast rather than written out. `GameHostCapabilities` requires all ninety-odd keys to be named,
 * which is what stops a real host quietly dropping one and is pure noise in a fixture whose subject
 * is a single family - and "not named" and "named as `undefined`" reach the bridge identically,
 * which is exactly the state these cases contrast against.
 */
function capabilities(overrides: Partial<GameHostCapabilities>): GameHostCapabilities {
    return {
        onOpenSurface: async () => undefined,
        onPageBack: async () => undefined,
        onGetGamePreference: () => 1,
        onSetGamePreference: async () => undefined,
        widgetRuntimeStore: { subscribe: () => () => undefined, get: () => undefined },
        localizationConfig: null,
        voiceConfig: null,
        ...overrides,
    } as unknown as GameHostCapabilities;
}

function hostOptions(
    hostOverrides: Partial<GameHostCapabilities>,
    slotOverrides: Partial<GameUiSlotHostOptions> = {},
): GameUiSlotHostOptions {
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
        host: capabilities(hostOverrides),
        startStory: async () => undefined,
        setWidgetPatchesByScope: noop,
        widgetPatchesByScopeRef: { current: {} },
        ...slotOverrides,
    } as unknown as GameUiSlotHostOptions;
}

function renderShell(
    hostOverrides: Partial<GameHostCapabilities>,
    slotOverrides: Partial<GameUiSlotHostOptions> = {},
) {
    capturedOptions.length = 0;
    renderHook(() => useStageSlotSurfaceRuntime({
        options: hostOptions(hostOverrides, slotOverrides),
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

        const options = renderShell({ ...soundCapabilities(soundTransport), audioTracks: TRACKS });

        for (const key of SOUND_CALLBACKS) {
            expect(options[key], `${key} missing from the slot host API`).toBeTypeOf("function");
        }
        expect(options.onPlaySound).toBe(soundTransport.play);
        expect(options.onStopSound).toBe(soundTransport.stop);
        expect(options.onIsSoundPlaying).toBe(soundTransport.isPlaying);
    });

    it("reaches the engine when a slot's graph plays a sound", async () => {
        const soundTransport = createSoundTransportStub();

        const options = renderShell({ ...soundCapabilities(soundTransport), audioTracks: TRACKS });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);
        await hostApi.sound.play({ assetId: "click", audioTrackId: "sound" });

        // Before the fix this resolved to null without ever reaching a transport.
        expect(soundTransport.play).toHaveBeenCalledWith({ assetId: "click", audioTrackId: "sound" });
    });

    it("carries the project's tracks so the slot's video widgets obey the mixer", () => {
        const options = renderShell({
            ...soundCapabilities(createSoundTransportStub()),
            audioTracks: TRACKS,
        });

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
        const onExportProgress = vi.fn(async () => ({ outcome: "written" as const, error: "" }));
        const onImportProgress = vi.fn(async () => ({ outcome: "missing" as const, sceneId: "", error: "" }));

        const options = renderShell({ onExportProgress, onImportProgress });

        expect(options.onExportProgress).toBe(onExportProgress);
        expect(options.onImportProgress).toBe(onImportProgress);
    });

    it("reaches the shell when a slot's graph carries progress", async () => {
        // A title screen is exactly the kind of surface an author builds out of Game UI slots, so
        // this is the path the feature is for - not an edge case.
        const onExportProgress = vi.fn(async () => ({ outcome: "written" as const, error: "" }));
        const onImportProgress = vi.fn(async () => ({ outcome: "found" as const, sceneId: "chapter-2", error: "" }));

        const options = renderShell({ onExportProgress, onImportProgress });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        // Before the fix both of these refused without ever reaching a shell.
        await expect(hostApi.progress.export()).resolves.toEqual({ outcome: "written", error: "" });
        await expect(hostApi.progress.import()).resolves.toEqual({
            outcome: "found",
            sceneId: "chapter-2",
            error: "",
        });
        expect(onExportProgress).toHaveBeenCalled();
        expect(onImportProgress).toHaveBeenCalled();
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
        const onLocaleChanged = vi.fn(async () => undefined);

        const options = renderShell({ onLocaleChanged });

        expect(options.onLocaleChanged).toBe(onLocaleChanged);
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

    it("passes the dub languages and both playback callbacks to the slot's host API", () => {
        const onPlayVoice = vi.fn(async () => true);
        const onPlayChoiceVoice = vi.fn(async () => true);

        const options = renderShell({ voiceConfig: VOICE, onPlayVoice, onPlayChoiceVoice });

        expect(options.voiceConfig).toBe(VOICE);
        expect(options.onPlayVoice).toBe(onPlayVoice);
        expect(options.onPlayChoiceVoice).toBe(onPlayChoiceVoice);
    });

    it("lists the project's dub languages from inside a slot", async () => {
        const options = renderShell({ voiceConfig: VOICE });
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

        const options = renderShell({}, {
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
        const onGetSavedVariable = vi.fn(() => ({ value: 7, found: true }));
        const onSetSavedVariable = vi.fn();

        const options = renderShell({ onGetSavedVariable, onSetSavedVariable });

        expect(options.onGetSavedVariable).toBe(onGetSavedVariable);
        expect(options.onSetSavedVariable).toBe(onSetSavedVariable);
    });

    it("reads and writes the playthrough from inside a slot", async () => {
        const store = new Map<string, unknown>([["affection", 7]]);
        const options = renderShell({
            onGetSavedVariable: (id: string) => (store.has(id)
                ? { value: store.get(id), found: true }
                : { value: null, found: false }),
            onSetSavedVariable: (id: string, value: unknown) => { store.set(id, value); },
        });
        const hostApi = (await import("@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge"))
            .createDevModeBlueprintHostApi(options);

        expect(hostApi.game.getSavedVariable("affection")).toEqual({ value: 7, found: true });
        hostApi.game.setSavedVariable("affection", 42);
        expect(hostApi.game.getSavedVariable("affection")).toEqual({ value: 42, found: true });
    });
});
