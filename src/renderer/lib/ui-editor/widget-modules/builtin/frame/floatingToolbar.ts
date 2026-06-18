import { Share } from "lucide-react";
import type { FloatingToolbarContext, FloatingToolbarItem } from "@/lib/ui-editor/widget-modules/types";
import { getFrameProps } from "./helpers";

export function createFrameFloatingToolbarItems({
    element,
    documentService,
    openSurfaceEditor,
}: FloatingToolbarContext): FloatingToolbarItem[] {
    if (!openSurfaceEditor) {
        return [];
    }
    const targetSurfaceId = getFrameProps(element).targetSurfaceId;
    const targetSurface = targetSurfaceId
        ? documentService
              .getDocument()
              .surfaces
              .find(surface => surface.id === targetSurfaceId && surface.kind === "appSurface")
        : null;
    if (!targetSurface) {
        return [];
    }
    return [
        {
            kind: "button",
            id: "frame.open-target-page",
            icon: Share,
            tooltip: `Open ${targetSurface.name}`,
            onClick: () => openSurfaceEditor(targetSurface.id),
        },
    ];
}
