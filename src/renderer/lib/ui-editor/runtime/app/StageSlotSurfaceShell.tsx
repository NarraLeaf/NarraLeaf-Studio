import {
    useCallback,
    useEffect,
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
import { collectSurfaceFlushElementIds, hasWidgetFlushBlueprint } from "@/lib/ui-editor/runtime/game/surfaceFlushTargets";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import {
    buildGameHostApiOptions,
    type GameHostCapabilities,
    type GameHostSurfaceBinding,
} from "./gameHostApiOptions";
import { stageSlotRuntimeScopeId } from "./stageSlots";
import { isStageSlotConcealedByPage } from "./layers/stageOcclusion";
import { useStageCovered, useStageCoveredByPage } from "./stageConcealment";
import type { AmbientSurfaceTargets } from "./ambientSurfaceEvents";
import { createNestedSurfaceHost } from "./nestedSurfaceHost";
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
     * The name a player reads for a speaker the engine recorded by name - the character's name in the
     * game's language. What an NVL row's `nametag` shows; the dialogue box reads the same answer
     * through `Get Nametag`. Absent on a host that shows the story in the words it is written in.
     */
    displaySpeakerName?: (recordedName: string) => string;
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
    /**
     * Where a slot surface says it is live, so the game's window and preference events reach its
     * heads as they reach a page's (see `ambientSurfaceEvents`). Absent on a host that raises none of
     * those events, such as the story editor's preview.
     */
    ambientSurfaces?: AmbientSurfaceTargets;
    /**
     * Where a slot surface that takes input says it is live, so the keys reach it while the stage
     * owns the keyboard - the story on screen with nothing drawn over it (see `keyboardOwner`).
     * A display-only slot never registers: it answers no pointer, and answers no key either. Absent
     * on a host with no keyboard dispatch of its own, such as the story editor's preview.
     */
    stageKeyboardSurfaces?: AmbientSurfaceTargets;
    /**
     * The only slots a press may reach, when not every slot may. Absent means all of them, as in any
     * game. The story editor's preview passes the choice slot alone: its stage is a still the author
     * steps through, so a press anywhere else is the preview's own, and picking an option is the one
     * press that means the same there as in the game.
     */
    pressableSlots?: ReadonlySet<UIStageSlotId>;
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
        const runtime = hostAdapterRef.current?.blueprintRuntime;
        for (const elementId of flushElementIds) {
            const element = document.elements[elementId];
            if (!element || !runtime) {
                continue;
            }
            const payload = {
                element: {
                    surfaceId: surface.id,
                    elementId,
                    elementType: element.type,
                },
            };
            // A widget whose own graph answers the flush runs it once per drawing on screen: in a row
            // of the slot's list (a choice, an NVL line) it reads that row, rather than running once
            // as a row nobody draws. One kept only for its value bindings has no graph to run in a
            // row, so it stays a single flush rather than one per row for nothing.
            const drawings = hasWidgetFlushBlueprint(bundle.ui.localBlueprints, surface.id, element)
                ? runtime.drawings?.everyDrawingOf(elementId) ?? [{}]
                : [{}];
            for (const drawing of drawings) {
                void runtime.dispatchElementBlueprintEvent(elementId, "flush", payload, drawing);
            }
        }
    }, [bundle.ui.localBlueprints, document, flushElementIds, surface.id]);

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
    // Stepped off the screen, not unmounted, while a page is up: the line keeps revealing and the
    // graphs keep their state, so closing the page brings back exactly what it covered.
    const concealed = useStageCoveredByPage() && isStageSlotConcealedByPage(surface.mount.slotId);
    // The keys leave the whole stage with the story, notifications included: a page or a modal layer
    // over it owns them (see `keyboardOwner`), and a key head on a widget down here answering the same
    // press would be a second owner. They come back as the cover goes.
    //
    // So does the pointer. A page conceals the slot, which already takes it out of reach; a modal layer
    // leaves it on screen, and without this its buttons stayed live under the layer's scrim - the quick
    // menu's Log opened a page underneath a confirmation that had declared everything below it inert.
    const covered = useStageCovered();
    const hearsKeys = !covered;
    const pressable = !options.pressableSlots || options.pressableSlots.has(surface.mount.slotId);
    // The runtime store comes from the game's capabilities rather than from a second field beside
    // them: the store the widgets render against has to be the one the host API writes into.
    const { core, bundle, rendererRegistry, lifecycleRef, makeStateAccessors, widgetPatchesByScopeRef } = options;
    const { widgetRuntimeStore } = options.host;
    const document = bundle.ui.uidoc;
    const { runtimeScopeId, hostAdapter } = runtime;
    const [subscriptionsReady, setSubscriptionsReady] = useState(false);
    const handleRuntimeSubscriptionsReady = useCallback(() => setSubscriptionsReady(true), []);

    // Live from the moment its graphs run - the same moment its lifecycle boundary is handed the
    // core - until it leaves the stage.
    const { ambientSurfaces } = options;
    useEffect(() => {
        if (!ambientSurfaces || !core || !subscriptionsReady) {
            return undefined;
        }
        return ambientSurfaces.add({ surface, hostAdapter, runtimeScopeId });
    }, [ambientSurfaces, core, hostAdapter, runtimeScopeId, subscriptionsReady, surface]);
    // Heard by the keys from the same moment, for as long as it is on the stage - unless it is a
    // display-only slot, which is inert to every input.
    const { stageKeyboardSurfaces } = options;
    useEffect(() => {
        if (!stageKeyboardSurfaces || !core || !subscriptionsReady || passive) {
            return undefined;
        }
        return stageKeyboardSurfaces.add({ surface, hostAdapter, runtimeScopeId });
    }, [core, hostAdapter, passive, runtimeScopeId, stageKeyboardSurfaces, subscriptionsReady, surface]);
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

    /**
     * What a page placed in a Page widget on this surface runs on: the same runtime the game's pages
     * and layers hand theirs, built from the capabilities this surface was given - a choice menu's
     * own `Select Choice` included - so the embedded page shares the slot's host rather than getting
     * a smaller one. Without it the page is drawn and none of its graphs run.
     */
    const { host, startStory, setWidgetPatchesByScope } = options;
    const nestedSurfaceRuntime = useMemo(() => {
        if (!core) {
            return undefined;
        }
        return createNestedSurfaceHost({
            core,
            capabilities: host,
            bundle,
            startStory,
            widgetPatches: { setByScope: setWidgetPatchesByScope, byScopeRef: widgetPatchesByScopeRef },
            lifecycleRef,
            ambientSurfaces,
        });
    }, [ambientSurfaces, bundle, core, host, lifecycleRef, setWidgetPatchesByScope, startStory, widgetPatchesByScopeRef]);

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
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                    surfaceLifecycleSignals={STATIC_SURFACE_LIFECYCLE_SIGNALS}
                    onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
                    surfacePointerEvents={surfacePointerEvents}
                    // Covered, the slot is display-only for as long as the cover stays: inert, so no
                    // widget on it takes a press (see `passive`). So is a slot the host keeps presses
                    // away from (see `pressableSlots`).
                    passive={passive || covered || !pressable}
                    concealed={concealed}
                    keyboardInteractive={hearsKeys}
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
