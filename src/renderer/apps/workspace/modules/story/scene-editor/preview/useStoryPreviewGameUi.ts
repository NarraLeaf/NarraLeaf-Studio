import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Game, LiveGame } from "narraleaf-react";
import type { ReactNode } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import {
    BLUEPRINT_GAME_CHARACTERS_STATE_KEY,
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY,
} from "@shared/types/blueprint/hostApi";
import {
    toBlueprintCharacterInfo,
    type BlueprintCharacterInfo,
} from "@shared/types/blueprint/characterInfo";
import { DEFAULT_UI_SURFACE_SIZE } from "@shared/constants/ui-editor";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { useBlueprintRuntimeCore, type BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import { SurfaceLifecycleOrchestrator } from "@/lib/ui-editor/runtime/app/lifecycle/surfaceLifecycleOrchestrator";
import type { GameUiSlotHostOptions } from "@/lib/ui-editor/runtime/app/StageSlotSurfaceShell";
import type { ChoiceSlotRuntime } from "@/lib/ui-editor/runtime/app/ChoiceSlotSurface";
import {
    createGameUiSlotComponents,
    createLiveGameUiCallbacks,
    createNlrGameWithGameUi,
} from "@/lib/ui-editor/runtime/app/gameUiSlots";
import { audioTracksToBusDeclarations } from "@/lib/ui-editor/runtime/app/audioBusRuntime";
import { readNlrCharacterName } from "@/lib/ui-editor/runtime/app/nlrDialogReaders";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import type { StoryPersistenceBridge } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import { buildPersistentRuntimeTable, buildSavedRuntimeTable } from "@shared/variables/variableRegistryModel";

const PREVIEW_BUNDLE_ID = "workspace-story-preview";

export type StoryPreviewIssue = {
    level: "warning" | "error";
    message: string;
};

export type StoryPreviewGame = {
    game: Game;
    onStageNode?: ReactNode;
    /** Wire session-scoped LiveGame bridges (nametag → blueprint global state). Returns a disposer. */
    wireLiveGame: (liveGame: LiveGame) => () => void;
};

export type StoryPreviewGameUiHost = {
    /** False until the blueprint runtime core has mounted for the synthesized bundle. */
    ready: boolean;
    designSize: { width: number; height: number };
    characters: ReturnType<typeof mapCharacterStoreEntriesToSummaries>;
    blueprintDocument: DevModeBundle["ui"]["localBlueprints"] | undefined;
    /** In-memory persistent-variable bridge (no host storage in the workspace preview). */
    persistence: StoryPersistenceBridge | undefined;
    /** Build a per-session NLR Game rendering the project's custom Game UI slots. */
    createPreviewGame: (input: {
        sessionId: string;
        requireLiveGame: (operation: string) => LiveGame;
        getLiveGame: () => LiveGame | null;
        /** Invert a dialog-avatar URL back to its asset id, from this compile's own inverse. */
        resolveAvatarAssetId?: (url: string) => string | null;
    }) => StoryPreviewGame;
};

/**
 * Assembles everything the story preview needs to render the project's custom Game UI around an
 * embedded NLR Player inside the workspace window: a synthesized DevModeBundle from live workspace
 * services, a blueprint runtime core (IPC-free), and per-session Game UI slot host options with
 * real LiveGame callbacks and explicit no-op stubs for navigation/saves/quit.
 *
 * The bundle snapshots the uidoc/blueprints when `enabled` flips on - Game UI edits made while the
 * preview is open apply the next time the preview reopens.
 */
export function useStoryPreviewGameUi(input: {
    context: WorkspaceContext | null;
    enabled: boolean;
    onIssue?: (issue: StoryPreviewIssue) => void;
}): StoryPreviewGameUiHost {
    const { context, enabled, onIssue } = input;

    const onIssueRef = useRef(onIssue);
    onIssueRef.current = onIssue;

    const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);
    const widgetRuntimeStore = useMemo(() => new WidgetRuntimeStateStore(), []);
    const lifecycleRef = useRef(new SurfaceLifecycleOrchestrator());
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    // Refs shared by the Game UI slots and the LiveGame callbacks across a session.
    const choiceRuntimeRef = useRef<ChoiceSlotRuntime | null>(null);
    const currentDialogNametagRef = useRef<string | null>(null);
    const dialogVirtualClickTargetRef = useRef<HTMLElement | null>(null);

    const designSize = useMemo(() => {
        if (!context) {
            return DEFAULT_UI_SURFACE_SIZE;
        }
        const projectService = context.services.get<ProjectService>(Services.Project);
        return projectService.getProjectConfig().metadata?.resolution ?? DEFAULT_UI_SURFACE_SIZE;
    }, [context]);

    const characters = useMemo(() => {
        if (!context || !enabled) {
            return [];
        }
        const characterService = context.services.get<CharacterService>(Services.Character);
        return mapCharacterStoreEntriesToSummaries(characterService.listCharacter().map(character => character.toJSON()));
    }, [context, enabled]);

    /**
     * The blueprint-facing character table, read straight off the character service rather than off
     * the summaries above. The summary shape is the story compiler's, and it carries only what the
     * *engine* needs; the accent colour is editor data the compiler has no use for.
     */
    const characterTable = useMemo((): BlueprintCharacterInfo[] => {
        if (!context || !enabled) {
            return [];
        }
        const characterService = context.services.get<CharacterService>(Services.Character);
        return characterService.listCharacter().flatMap(character => {
            const info = toBlueprintCharacterInfo({
                id: character.profile.getId(),
                name: character.profile.getName(),
                color: character.profile.getColor(),
                avatarAssetId: character.profile.getDefaultAvatarAssetId(),
            });
            return info ? [info] : [];
        });
    }, [context, enabled]);

    // Snapshot the uidoc/blueprints into a synthetic bundle when the preview opens.
    const bundle = useMemo((): DevModeBundle | null => {
        if (!context || !enabled) {
            return null;
        }
        const uiDocumentService = context.services.get<UIDocumentService>(Services.UIDocument);
        const uiGraphService = context.services.get<UIGraphService>(Services.UIGraph);
        const localBlueprintService = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        // One registry read, both projections - a second `getRegistry()` could observe a write landing
        // between the two and hand the synthetic bundle two mismatched halves of one file.
        const registry = context.services.get<VariableRegistryService>(Services.VariableRegistry).getRegistry();
        return {
            bundleId: PREVIEW_BUNDLE_ID,
            revision: 1,
            timestamp: new Date().toISOString(),
            ui: {
                uidoc: uiDocumentService.getDocument(),
                uigraphs: uiGraphService.getDocument(),
                localBlueprints: localBlueprintService.getBlueprintDocument(),
                sharedBlueprints: [],
                persistentVariables: buildPersistentRuntimeTable(registry),
                savedVariables: buildSavedRuntimeTable(registry),
            },
        };
    }, [context, enabled]);

    const handleDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (event.type === "execution.error") {
            const message = (event as { message?: unknown }).message;
            onIssueRef.current?.({
                level: "warning",
                message: `Game UI blueprint error: ${typeof message === "string" ? message : "unknown error"}`,
            });
        }
    }, []);

    const core = useBlueprintRuntimeCore(bundle, {
        persistenceAdapter: null,
        onDebugEvent: handleDebugEvent,
        disposeMessage: "Story preview disposed",
    });

    const persistence = useMemo((): StoryPersistenceBridge | undefined => {
        if (!core) {
            return undefined;
        }
        return {
            get: key => core.scopeBridge.persistenceGet(key),
            set: (key, value) => core.scopeBridge.persistenceSet(key, value),
        };
    }, [core]);

    const blueprintDocument = bundle?.ui.localBlueprints;

    // Parity with the Dev Mode host: this mirror is what `Get Character` reads, and the dialog
    // slot's DialogStateBridge joins it against the staged speaker id to derive `Get Speaker Color`.
    useEffect(() => {
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_CHARACTERS_STATE_KEY, characterTable);
    }, [core, characterTable]);

    const createPreviewGame = useCallback((gameInput: {
        sessionId: string;
        requireLiveGame: (operation: string) => LiveGame;
        getLiveGame: () => LiveGame | null;
        resolveAvatarAssetId?: (url: string) => string | null;
    }): StoryPreviewGame => {
        if (!bundle) {
            throw new Error("Story preview: bundle is not ready");
        }
        const activeCore: BlueprintRuntimeCore | null = core;
        choiceRuntimeRef.current = null;
        currentDialogNametagRef.current = null;
        dialogVirtualClickTargetRef.current = null;

        const liveGameCallbacks = createLiveGameUiCallbacks({
            requireLiveGame: gameInput.requireLiveGame,
            getLiveGame: gameInput.getLiveGame,
            choiceRuntimeRef,
            currentDialogNametagRef,
            dialogVirtualClickTargetRef,
        });
        const notAvailable = (operation: string) => async (): Promise<never> => {
            throw new Error(`${operation} is not available in the story preview`);
        };
        // Frozen once per session - hostApi memos key off this object's identity.
        const slotHostOptions: GameUiSlotHostOptions = {
            sessionId: gameInput.sessionId,
            core: activeCore,
            bundle,
            rendererRegistry,
            lifecycleRef,
            makeStateAccessors: runtimeScopeId => {
                if (!activeCore) {
                    return null;
                }
                const store = activeCore.scopeBridge.getSurfaceStore(runtimeScopeId);
                return {
                    get: (key: string) => store.get(key),
                    set: (key: string, value: unknown) => store.set(key, value),
                };
            },
            // Navigation, application, and save APIs do not exist inside the editor preview;
            // blueprint calls reach these stubs and surface as execution.error debug events.
            openSurfaceWithTransition: async () => undefined,
            closeLayerWithTransition: async () => undefined,
            quitApplication: async () => undefined,
            // The preview renders into a Studio panel, not an application window.
            resolveAvatarAssetId: gameInput.resolveAvatarAssetId,
            getFullscreen: notAvailable("Get Fullscreen"),
            setFullscreen: notAvailable("Set Fullscreen"),
            startStoryInGame: notAvailable("Start Story"),
            writeSaveInGame: notAvailable("Save Game"),
            loadSaveInGame: notAvailable("Load Save"),
            deleteSaveInGame: notAvailable("Delete Save"),
            listSaveIds: async () => [],
            getSaveMetadata: async () => null,
            getSavePreview: async () => null,
            writeAutoSaveInGame: notAvailable("Auto Save"),
            listAutoSaves: async () => [],
            isInGame: () => true,
            quitGame: notAvailable("Quit Game"),
            ...liveGameCallbacks,
            setWidgetPatchesByScope,
            widgetPatchesByScopeRef,
            widgetRuntimeStore,
        };
        const slots = createGameUiSlotComponents({
            uidoc: bundle.ui.uidoc,
            logLabel: "story-preview",
            slotHostOptions,
            setDialogVirtualClickTarget: target => {
                dialogVirtualClickTargetRef.current = target;
            },
            setChoiceRuntime: runtime => {
                choiceRuntimeRef.current = runtime;
            },
        });
        const game = createNlrGameWithGameUi({
            width: designSize.width,
            height: designSize.height,
            contentContainerId: `__nlr_story_preview_${gameInput.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            slots,
            // The preview pane can be far smaller than NLR's 800×450 minimum stage; without this
            // the stage overflows and crops instead of letterboxing down.
            minStageSize: { width: 1, height: 1 },
            // The preview has to declare the project's buses for the same reason Dev Mode does: a
            // clip on an undeclared bus falls back to a seeded one, so a per-character voice would
            // preview through the plain Voice fader and sound right while proving nothing.
            audioBuses: context
                ? audioTracksToBusDeclarations(
                    context.services.get<AudioTrackService>(Services.AudioTracks).listTracks(),
                )
                : undefined,
        });

        // The author's preference defaults, so the preview types at the speed the shipped game will.
        // Defaults only, and no persistence: the preview is a look at a *fresh* game, and writing
        // the preview's own volume changes into the player's store would be the editor answering a
        // question only a player gets to answer.
        if (context) {
            const defaults = context.services.get<ProjectService>(Services.Project).getPlayerPreferences();
            game.preference.importPreferences(defaults);
        }

        const wireLiveGame = (liveGame: LiveGame): (() => void) => {
            const token = liveGame.onCharacterPrompt(({ character }) => {
                const nametag = readNlrCharacterName(character);
                currentDialogNametagRef.current = nametag;
                activeCore?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
                // The preview does not translate the nametag, so the reported name *is* the source
                // name and matches the table directly. A `/temp` speaker is in no table: null.
                activeCore?.scopeBridge.globalSet(
                    BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY,
                    characterTable.find(entry => entry.name === nametag)?.id ?? null,
                );
            });
            return () => {
                token.cancel();
                currentDialogNametagRef.current = null;
                activeCore?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
                activeCore?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY, null);
                activeCore?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY, null);
            };
        };

        return { game, onStageNode: slots.onStageNode, wireLiveGame };
    }, [bundle, characterTable, core, designSize.height, designSize.width, rendererRegistry, widgetRuntimeStore]);

    return {
        ready: Boolean(bundle && core),
        designSize,
        characters,
        blueprintDocument,
        persistence,
        createPreviewGame,
    };
}
