/**
 * Shared types for the game app orchestration layer used by both Studio
 * Dev Mode (src/renderer/apps/dev-mode) and the standalone game runtime
 * (src/runtime/renderer).
 */

import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { SurfaceBlueprintBindingContext } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";

export type SurfaceStateAccessors = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
};

export type PageProps = Record<string, unknown>;

export type OpenSurfaceOptions = {
    presentation?: import("@/lib/ui-editor/runtime/game/surfaceNavigationController").SurfaceNavigationPresentation;
};

/** Per-layer blueprint host wiring created by the host app's factory. */
export type HostAdapterBundle = {
    hostAdapter: UIHostAdapter;
    bindingContext: SurfaceBlueprintBindingContext;
    runtimeScopeId: string;
};

/** Host adapter for surfaces rendered without a blueprint runtime. */
export const staticSurfaceHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
});
