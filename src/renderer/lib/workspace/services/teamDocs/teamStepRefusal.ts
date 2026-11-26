import type { TranslationKey } from "@shared/i18n";
import { translate } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../services";
import type { UIService } from "../core/UIService";

/** Why a step on a team project's document was not taken. */
export type TeamStepRefusalReason =
    /** A record the step wrote has been changed by somebody since. */
    | "changed"
    /** What the step is about has been deleted since. */
    | "gone"
    /** The step was recorded offline and has no way through the server (an asset's bytes). */
    | "offline";

const DETAIL: Record<TeamStepRefusalReason, string> = {
    changed: "workspace.history.team.changed",
    gone: "workspace.history.team.gone",
    offline: "workspace.history.team.offline",
};

/** Thrown by an undo or redo that refused, so the history service keeps the step where it was. */
export class TeamStepRefused extends Error {}

/**
 * Tell the author why Ctrl+Z did nothing, and throw so the step stays on its stack. For the undo
 * steps services record themselves - offline, in a team project - that find the server owns the
 * document by the time they are taken.
 */
export function refuseTeamStep(ctx: WorkspaceContext, direction: "undo" | "redo", reason: TeamStepRefusalReason): never {
    const title = direction === "undo" ? "workspace.history.team.undoRefused" : "workspace.history.team.redoRefused";
    try {
        ctx.services.get<UIService>(Services.UI).notifications.warning(
            translate(title as TranslationKey),
            translate(DETAIL[reason] as TranslationKey),
        );
    } catch {
        // No interface to tell (a test, a closing workspace): the refusal still stands.
    }
    throw new TeamStepRefused(`Team ${direction} refused: ${reason}`);
}
