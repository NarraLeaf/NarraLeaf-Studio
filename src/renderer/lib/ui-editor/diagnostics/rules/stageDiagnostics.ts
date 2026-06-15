import type { UIStageSurface, UISurface } from "@shared/types/ui-editor/document";
import type { UISurfaceDiagnostic } from "../types";

export function collectStageDiagnostics(surface: UISurface): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    if (surface.kind !== "stageSurface") {
        return out;
    }
    const st = surface as UIStageSurface;
    if (st.mount.kind === "slot" && st.mount.slotId === "none" && st.link?.kind === "appSurface") {
        out.push({
            id: `stage:slot-none-link:${surface.id}`,
            severity: "warning",
            source: "stage",
            message: "Stage uses Slot “None” while an App Surface link is set",
            hint: "Confirm mount slot matches how this surface should appear in the player.",
        });
    }
    return out;
}
