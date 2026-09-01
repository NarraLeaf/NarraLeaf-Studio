import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    createDevModeBlueprintHostApi,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { collectSurfaceFlushElementIds } from "@/lib/ui-editor/runtime/game/surfaceFlushTargets";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import {
    buildGameHostApiOptions,
    type GameHostCapabilities,
    type GameHostSurfaceBinding,
} from "./gameHostApiOptions";
import { stageSlotRuntimeScopeId } from "./stageSlots";
import { staticSurfaceHostAdapter, type SurfaceStateAccessors } from "./types";

/**
 * Host callbacks shared by every Game UI slot surface. Built once per NLR session in
 * `GameApp.mountNlrSession()` and passed to each slot component factory.
 */
export type GameUiSlotHostOptions = {
    sessionId: string;
    /** The player asked for less motion: the widgets on a slot surface stay put. */
    reducedMotion?: boolean;
    core: BlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    rendererRegistry: ElementRendererRegistry;
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    /**
     * Invert a dialog-avatar URL back to the asset id it was compiled from. The engine resolves
     * avatars to URLs; a blueprint pin carries an `ImageAsset`. Absent on hosts with no compiled
     * story, where there are no avatars to invert.
     */
    resolveAvatarAssetId?: (url: string) => string | null;
    /**
     * The whole game host, as one value.
     *
     * This used to be sixty-odd fields declared here and forwarded one by one into the slot's own
     * host API, which is how a capability could reach the pages of a game and not its dialogue box:
     * every one of those options is optional, so a name left off the list was indistinguishable
     * from a host that could not do the thing, and the node answered the bridge's default in
     * silence. It went wrong five times - sound, progress, the saved variables, a batch of
     * twenty-five, and `voiceConfig`, whose absence made every voice node blame the author's
     * project for having no dub languages.
     *
     * The list is gone. Whoever owns the game builds {@link GameHostCapabilities} once and hands
     * the same value to every surface of it, and `buildGameHostApiOptions` is the only thing that
     * turns it into bridge options - so a slot surface can no longer be handed less than a page.
     */
    host: GameHostCapabilities;
    /**
     * The player's way into a story from a slot surface.
     *
     * Separate from {@link GameUiSlotHostOptions.host} because it is the one capability the three
     * surfaces of a game legitimately reach differently, and an absence should never be how that is
     * said. A slot keeps whatever callable it was handed when its session was mounted, so a real
     * game gives it the boot gate - which finds the runtime through a ref at call time and waits
     * out a boot still in flight - while a page host, rebuilt whenever the runtime's own start
     * changes, holds that start directly.
     */
    startStory: GameHostSurfaceBinding["startStory"];
    setWidgetPatchesByScope: Dispatch<SetStateAction<WidgetPatchesByScope>>;
    widgetPatchesByScopeRef: MutableRefObject<WidgetPatchesByScope>;
};

export type StageSlotSurfaceRuntime = {
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    hostAdapterRef: MutableRefObject<UIHostAdapter | null>;
    /** Dispatches `flush` to every element of this surface with value bindings or flush logic. */
    flushSlotElements: () => void;
};

/** Widget-runtime store key for a slot surface element (matches `scopedWidgetRuntimeKey`). */
export function stageSlotWidgetRuntimeKey(runtimeScopeId: string, elementId: string): string {
    return `${runtimeScopeId}\0${elementId}`;
}

/** Collects element ids of the given widget type inside the surface tree (document order). */
export function collectSurfaceElementIdsByType(
    document: DevModeBundle["ui"]["uidoc"],
    surface: UIStageSurface,
    elementType: string,
): string[] {
    const out: string[] = [];
    const visit = (elementId: string) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        if (element.type === elementType) {
            out.push(elementId);
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(surface.rootElementId);
    return out;
}

/**
 * Slot-agnostic runtime wiring shared by all Game UI slot surfaces: per-slot blueprint host
 * API/adapter (scoped to `nlr:<sessionId>:slot:<slotId>:<surfaceId>`) and flush dispatch to the
 * surface's value-bound / flush-capable elements.
 */
export function useStageSlotSurfaceRuntime(input: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    slotId: UIStageSlotId;
    /**
     * Which drawing of this slot's surface this is, for the slot that can have several at once - see
     * `stageSlotRuntimeScopeId`. Left at zero by every slot drawn once, which is all of them but
     * choice, and by the first menu when there are several.
     */
    slot?: number;
}): StageSlotSurfaceRuntime {
    const { options, surface, slotId, slot = 0 } = input;
    const {
        sessionId,
        core,
        bundle,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
    } = options;
    const runtimeScopeId = useMemo(
        () => stageSlotRuntimeScopeId(sessionId, slotId, surface.id, slot),
        [sessionId, slotId, surface.id, slot],
    );
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = bundle.ui.uidoc;

    const hostApi = useMemo(() => {
        if (!core) {
            return null;
        }
        return createDevModeBlueprintHostApi(buildGameHostApiOptions(options.host, {
            document,
            scope: core.scopeBridge,
            emit: event => core.debug.emit(event),
            activeSurfaceId: surface.id,
            runtimeScopeId,
            // A slot surface is put on the screen by the story rather than opened by anyone, so
            // there is nothing it could have been opened *with*.
            pageProps: {},
            // Always: a Game UI slot is only ever drawn by a running game, so a graph asking
            // whether it is over one is asking about the game it is part of.
            isGameOverlay: () => true,
            startStory: options.startStory,
            widgetPatches: {
                setByScope: setWidgetPatchesByScope,
                byScopeRef: widgetPatchesByScopeRef,
            },
            resolveHostAdapter: () => hostAdapterRef.current,
        }));
    }, [
        core,
        document,
        options,
        runtimeScopeId,
        setWidgetPatchesByScope,
        surface.id,
        widgetPatchesByScopeRef,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!core || !hostApi) {
            return {
                ...staticSurfaceHostAdapter(surface),
                gameUiRuntime: { slotId },
            };
        }
        return {
            ...createDevModeBlueprintHostAdapter({
                bundle,
                surface,
                runtimeScopeId,
                scopeBridge: core.scopeBridge,
                debug: core.debug,
                hostApi,
                executionManager: core.executionManager,
            }),
            gameUiRuntime: { slotId },
        };
    }, [core, bundle, hostApi, runtimeScopeId, slotId, surface]);

    // Assigned while rendering rather than from an effect: the ref is read by children (the dialog
    // slot's state bridge flushes through it), and a child's effect runs before this component's
    // does. Filled in from an effect, the very first flush after a mount found `null` and was
    // dropped without a word - which is how a scene jump used to leave the previous speaker's
    // avatar on the line that replaced it. Mirroring a memoized value is idempotent, so a repeated
    // render writes the same adapter.
    hostAdapterRef.current = hostAdapter;

    const flushElementIds = useMemo(
        () => collectSurfaceFlushElementIds({
            document,
            blueprintDocument: bundle.ui.localBlueprints,
            surface,
        }),
        [bundle.ui.localBlueprints, document, surface],
    );
    const flushSlotElements = useCallback(() => {
        for (const elementId of flushElementIds) {
            const element = document.elements[elementId];
            if (!element) {
                continue;
            }
            void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                elementId,
                "flush",
                {
                    element: {
                        surfaceId: surface.id,
                        elementId,
                        elementType: element.type,
                    },
                },
            );
        }
    }, [document, flushElementIds, surface.id]);

    return { runtimeScopeId, hostAdapter, hostAdapterRef, flushSlotElements };
}

const STATIC_SURFACE_LIFECYCLE_SIGNALS = { beforeSurfaceExit: 0, afterSurfaceEnter: 0 };

/** See the note on `NO_WIDGET_RUNTIME_PATCHES` in AppSurfaceLayer: a fresh `{}` defeats the memo. */
const NO_WIDGET_RUNTIME_PATCHES: Record<string, DevModeWidgetRuntimePatch> = {};

/**
 * Shared render body for Game UI slot surfaces: lifecycle boundary + widget runtime provider +
 * surface renderer. Slot components wrap this in their slot-specific NLR chrome.
 *
 * Mirrors {@link AppSurfaceLayer}'s coordination: `core` is withheld from the lifecycle boundary
 * until the surface renderer has registered its blueprint runtime subscriptions
 * (`onRuntimeSubscriptionsReady`). This prevents Dev Mode's StrictMode throwaway mount from
 * closing the execution scope, which would otherwise abort the real mount's widget `init` dispatch
 * (an already-closed scope cancels queued executions).
 */
export function StageSlotSurfaceBody(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    runtime: StageSlotSurfaceRuntime;
    /** "none" makes the surface shell click-through (On-Stage overlay). */
    surfacePointerEvents?: CSSProperties["pointerEvents"];
    /** Display-only slot: no widget inside takes pointer events (notification toasts). */
    passive?: boolean;
}) {
    const { options, surface, runtime, surfacePointerEvents, passive } = props;
    // The runtime store comes from the game's capabilities rather than from a second field beside
    // them: the store the widgets render against has to be the one the host API writes into.
    const { core, bundle, rendererRegistry, lifecycleRef, makeStateAccessors, widgetPatchesByScopeRef } = options;
    const { widgetRuntimeStore } = options.host;
    const document = bundle.ui.uidoc;
    const { runtimeScopeId, hostAdapter } = runtime;
    const [subscriptionsReady, setSubscriptionsReady] = useState(false);
    const handleRuntimeSubscriptionsReady = useCallback(() => setSubscriptionsReady(true), []);
    const getWidgetRuntimePatches = useCallback(
        () => widgetPatchesByScopeRef.current[runtimeScopeId] ?? NO_WIDGET_RUNTIME_PATCHES,
        [runtimeScopeId, widgetPatchesByScopeRef],
    );

    const globalStateReader = useMemo(() => {
        if (!core) {
            return undefined;
        }
        return {
            get: (key: string) => core.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => core.scopeBridge.subscribeGlobals(listener),
        };
    }, [core]);

    const bindingContext = useMemo(() => {
        if (!core) {
            return null;
        }
        return {
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: globalStateReader,
        };
    }, [core, bundle.ui.localBlueprints, globalStateReader, runtimeScopeId]);

    return (
        <SurfaceLifecycleBoundary
            core={core}
            ready={subscriptionsReady}
            blueprintDocument={bundle.ui.localBlueprints}
            persistentVariables={bundle.ui.persistentVariables}
            surface={surface}
            runtimeScopeId={runtimeScopeId}
            hostAdapter={hostAdapter}
            lifecycleRef={lifecycleRef}
            makeStateAccessors={makeStateAccessors}
        >
            <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                <GameSurfaceRenderer
                    document={document}
                    surface={surface}
                    rendererRegistry={rendererRegistry}
                    scale={1}
                    hostAdapter={hostAdapter}
                    blueprintBindingContext={bindingContext}
                    getWidgetRuntimePatches={getWidgetRuntimePatches}
                    surfaceLifecycleSignals={STATIC_SURFACE_LIFECYCLE_SIGNALS}
                    onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
                    surfacePointerEvents={surfacePointerEvents}
                    passive={passive}
                    // A Game UI slot has no page animation of its own - it appears when the scene
                    // says so - but the widgets on it can still arrive and leave on their own terms.
                    elementAnimations
                    reducedMotion={options.reducedMotion === true}
                    // The uidoc here is the compiled bundle's; nothing edits it in place.
                    staticDocument
                />
            </WidgetRuntimeStateProvider>
        </SurfaceLifecycleBoundary>
    );
}
