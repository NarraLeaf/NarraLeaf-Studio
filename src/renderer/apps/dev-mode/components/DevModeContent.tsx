import { FixedAspectRatioContainer } from "narraleaf-react";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UISurface, UIDocument } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { DevModeSurfaceRenderer } from "./DevModeSurfaceRenderer";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { useDevModeBlueprintRuntime } from "../hooks/useDevModeBlueprintRuntime";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
};

const staticDevHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
    effects: {
        runEffect: () => {},
    },
});

export function DevModeContent(props: DevModeContentProps) {
    const { bundle, surface, surfaceId, rendererRegistry, scale, handleAspectUpdate } = props;
    const bpRuntime = useDevModeBlueprintRuntime(bundle, surface);

    if (!bundle) {
        return (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                Waiting for Dev Mode payload...
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                Surface not found: {surfaceId}
            </div>
        );
    }

    const document: UIDocument = bundle.ui.uidoc;
    const aspectRatio = surface.designSize.width / surface.designSize.height;
    const baseWidth = surface.designSize.width;
    const baseHeight = surface.designSize.height;

    const hostAdapter = bpRuntime?.hostAdapter ?? staticDevHostAdapter(surface);
    const bindingContext =
        bpRuntime != null
            ? {
                  blueprintDocument: bundle.ui.localBlueprints,
                  surfaceState: bpRuntime.surfaceState,
                  debug: bpRuntime.debug,
                  coalescer: bpRuntime.bindingDebugCoalescer,
              }
            : null;

    return (
        <div className="flex h-full w-full min-h-0 overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
                <FixedAspectRatioContainer
                    aspectRatio={aspectRatio}
                    baseWidth={baseWidth}
                    className="overflow-hidden"
                    debounceMs={0}
                    onUpdate={handleAspectUpdate}
                >
                    <DevModeSurfaceRenderer
                        document={document}
                        surface={surface}
                        rendererRegistry={rendererRegistry}
                        scale={scale}
                        hostAdapter={hostAdapter}
                        blueprintBindingContext={bindingContext}
                    />
                </FixedAspectRatioContainer>
            </div>
            {bpRuntime ? <BlueprintRuntimeDebugPanel debug={bpRuntime.debug} /> : null}
        </div>
    );
}
