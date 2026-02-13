import { FixedAspectRatioContainer } from "narraleaf-react";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UISurface, UIDocument } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { DevModeSurfaceRenderer } from "./DevModeSurfaceRenderer";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
};

export function DevModeContent(props: DevModeContentProps) {
    const { bundle, surface, surfaceId, rendererRegistry, scale, handleAspectUpdate } = props;

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

    return (
        <div className="h-full w-full min-h-0 overflow-hidden">
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
                />
            </FixedAspectRatioContainer>
        </div>
    );
}
