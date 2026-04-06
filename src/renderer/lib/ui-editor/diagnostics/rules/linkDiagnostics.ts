import type { UIStageSurface, UISurface } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UISurfaceDiagnostic } from "../types";

export function collectLinkDiagnostics(document: UIDocument, surface: UISurface): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    if (surface.kind !== "stageSurface") {
        return out;
    }
    const st = surface as UIStageSurface;
    if (st.link?.kind !== "appSurface") {
        return out;
    }
    const targetId = st.link.surfaceId;
    if (targetId === surface.id) {
        out.push({
            id: `link:self:${surface.id}`,
            severity: "error",
            source: "link",
            message: "Stage Surface links to itself",
            hint: "Pick another App Surface or clear the link.",
        });
        return out;
    }
    const target = document.surfaces.find(s => s.id === targetId);
    if (!target) {
        out.push({
            id: `link:missing:${surface.id}:${targetId}`,
            severity: "error",
            source: "link",
            message: "Linked App Surface does not exist",
            hint: "Choose a valid App Surface in Scene Properties.",
        });
        return out;
    }
    if (target.kind !== "appSurface") {
        out.push({
            id: `link:not-app:${surface.id}:${targetId}`,
            severity: "error",
            source: "link",
            message: "Linked target is not an App Surface",
            hint: "Link must target an App Surface only.",
        });
    }
    return out;
}
