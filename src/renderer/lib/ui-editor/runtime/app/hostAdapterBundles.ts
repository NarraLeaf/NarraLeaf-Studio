/**
 * One blueprint host per drawn entry, whoever asks for it.
 *
 * A page is reached from two places. Its layer draws it, and every pointer-driven graph on it runs
 * through the host adapter the layer holds. `GameApp` also dispatches to the page on its own - the
 * key presses and the declared actions they raise, the menu bar, window focus and fullscreen, a
 * preference changing, a close request - because none of those is aimed at anything on the page.
 *
 * Those two used to build a host each, from the same inputs, for the same runtime scope, and the
 * host is not stateless: its adapter keeps the rows the page's lists have on screen (what a
 * broadcast or a window event fans out over), the page's transition state (what `Is Surface
 * Entering` reads) and its queue of pending flushes, and its host API keeps animation waiters. So
 * every one of `GameApp`'s dispatches ran against a page nobody had drawn: an Escape handler asking
 * "is the viewer open?" was answered from the moment the page was opened, and a broadcast sent from
 * it reached no row of any list. The widget state half of that is closed at the source - no host
 * API keeps a copy of it any more, see `readWidgetPatches` - but the rest is the host itself, so the
 * answer is that there is only one.
 *
 * Keyed by the entry object, as the layer's own memo is: an entry cloned by navigation (a page
 * being gone back to, one leaving from behind) is drawn by a layer that re-memoises on it, and the
 * same object is what the page stack hands `GameApp` as its active entry. A weak map, so a closed
 * entry takes its host with it without anyone having to say so.
 *
 * Comments in English per project convention.
 */

import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import {
    createDevModeBlueprintHostApi,
    type CreateBlueprintHostApiRuntimeOptions,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { SurfaceBlueprintBindingContext } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import {
    buildGameHostApiOptions,
    type GameHostCapabilities,
    type GameHostSurfaceBinding,
} from "./gameHostApiOptions";
import type { HostAdapterBundle } from "./types";

export type HostAdapterBundleFor = (entry: AppSurfaceLayerNavEntry, surface: UISurface) => HostAdapterBundle | null;

/** What every page and layer host of one running game is built from. */
export type PageHostInputs = {
    core: BlueprintRuntimeCore;
    capabilities: GameHostCapabilities;
    bundle: DevModeBundle;
    startStory: CreateBlueprintHostApiRuntimeOptions["onStartStory"];
    widgetPatches: GameHostSurfaceBinding["widgetPatches"];
};

/**
 * The host one page or layer entry is drawn with: its blueprint host API, the adapter graphs are
 * dispatched through, and the binding context its value bindings read.
 *
 * Built, not looked up - {@link cacheHostAdapterBundles} is what makes it one per entry.
 */
export function buildPageHostAdapterBundle(
    inputs: PageHostInputs,
    entry: AppSurfaceLayerNavEntry,
    surface: UISurface,
): HostAdapterBundle {
    const { core, capabilities, bundle } = inputs;
    const runtimeScopeId = entry.runtimeScopeId;
    let hostAdapter: UIHostAdapter | null = null;
    const hostApi = createDevModeBlueprintHostApi(buildGameHostApiOptions(capabilities, {
        document: bundle.ui.uidoc,
        scope: core.scopeBridge,
        emit: event => core.debug.emit(event),
        activeSurfaceId: surface.id,
        runtimeScopeId,
        pageProps: entry.props,
        // How the page was pushed decides it: an entry opened as a game overlay is drawn over a
        // running playthrough, and one opened as a page is not.
        isGameOverlay: () => entry.presentation === "gameOverlay",
        startStory: inputs.startStory,
        widgetPatches: inputs.widgetPatches,
        resolveHostAdapter: () => hostAdapter,
    }));
    hostAdapter = createDevModeBlueprintHostAdapter({
        bundle,
        surface,
        runtimeScopeId,
        scopeBridge: core.scopeBridge,
        debug: core.debug,
        hostApi,
        executionManager: core.executionManager,
    });
    const bindingContext: SurfaceBlueprintBindingContext = {
        blueprintDocument: bundle.ui.localBlueprints,
        persistentVariables: bundle.ui.persistentVariables,
        surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
        debug: core.debug,
        coalescer: core.bindingDebugCoalescer,
        globalState: {
            get: key => core.scopeBridge.globalGet(key),
            subscribe: listener => core.scopeBridge.subscribeGlobals(listener),
        },
        pageProps: entry.props,
    };
    return { hostAdapter, bindingContext, runtimeScopeId };
}

/**
 * `build`, answered once per entry and surface.
 *
 * A new `build` is a new cache: the builder's identity is what changes when the host's inputs do
 * (the game's capabilities, the bundle, the runtime core), and a host built from the old ones must
 * not be handed out after that. The surface is checked as well as the entry because it is the other
 * half of what the host is built from.
 */
export function cacheHostAdapterBundles(build: HostAdapterBundleFor): HostAdapterBundleFor {
    const built = new WeakMap<AppSurfaceLayerNavEntry, { surface: UISurface; bundle: HostAdapterBundle | null }>();
    return (entry, surface) => {
        const hit = built.get(entry);
        if (hit && hit.surface === surface) {
            return hit.bundle;
        }
        const bundle = build(entry, surface);
        built.set(entry, { surface, bundle });
        return bundle;
    };
}
