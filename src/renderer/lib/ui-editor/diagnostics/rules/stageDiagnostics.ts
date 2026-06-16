import type { UISurface } from "@shared/types/ui-editor/document";
import type { UISurfaceDiagnostic } from "../types";

const VALID_GAME_UI_SLOTS = new Set(["onStage", "dialog", "notification", "choice"]);

export function collectStageDiagnostics(surface: UISurface): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    if (surface.kind !== "stageSurface") {
        return out;
    }
    if (!VALID_GAME_UI_SLOTS.has(surface.mount.slotId)) {
        out.push({
            id: `game-ui:slot-invalid:${surface.id}`,
            severity: "error",
            source: "stage",
            message: "Game UI uses an unknown slot",
            hint: "Choose On Stage, Dialog, Notification, or Choice.",
        });
    }
    return out;
}
