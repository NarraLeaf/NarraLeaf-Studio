import { Services, type WorkspaceContext } from "../services/services";
import { Service, type ServiceInitFailure } from "../services/Service";
import { RecoveryService } from "../services/core/RecoveryService";
import { freezeProjectWrites } from "@/lib/app/writeFreeze";
import { getInterface } from "@/lib/app/bridge";
import { reportWorkspaceAnomaly } from "./anomalyLog";

/**
 * The services a recovery shell brings up before the author sees anything.
 *
 * **This list is short on purpose and every absence is deliberate.** The promise recovery mode makes
 * is that the window opens - whatever is wrong with the project - and the only way to keep that
 * promise is for startup to touch as little of the project as possible. Everything left out is
 * available on demand as a probe (see `RecoveryService`), which is the better place for it: run by
 * hand, one at a time, with its failure shown next to the button that asked for it.
 *
 * What is here, and why it earns its place:
 *
 *  - `FileSystem` and `Uuid` read nothing and cannot fail.
 *  - `Project` reads the manifest. It *can* fail - a missing `.nlproj` is one of the ordinary ways
 *    to end up in recovery mode - and it is here anyway, because its answer is the first thing the
 *    author needs and the shell survives it either way.
 *  - `GlobalSettings` is Studio's own preferences, not project data.
 *  - `VersionControl` is what the recovery panel's lore section is made of, and it deliberately
 *    touches no backend on init.
 *  - `Recovery` is the probe state itself.
 *
 * Notably absent: `UI`. It pulls in the whole asset index through `depend`, which would turn the one
 * probe most likely to explain a broken project into something that had already run before the
 * author arrived - and the recovery panel is built to need no workspace UI service at all.
 */
export const RECOVERY_SHELL_SERVICES: readonly Services[] = [
    Services.FileSystem,
    Services.Uuid,
    Services.Project,
    Services.GlobalSettings,
    Services.VersionControl,
    Services.Recovery,
];

/**
 * Bring up the recovery shell over an already-created context.
 *
 * Freezes project writes *first* and never lifts them. That ordering is the safety property the
 * whole mode rests on: a service initialized after this line cannot write, so a load path that
 * "repairs" a file it could not parse - which is what several of them do, quite reasonably, during
 * an ordinary boot - becomes a read. The author's damaged file is still there to be diagnosed,
 * restored from history, or opened in another editor, which it would not be if merely looking at it
 * had reset it.
 */
export async function startRecoveryShell(ctx: WorkspaceContext): Promise<ServiceInitFailure[]> {
    const projectPath = ctx.project.getConfig().projectPath;
    freezeProjectWrites({ projectPath, reason: { kind: "recovery" } });
    // Told to main as well, because the renderer's latch only guards the renderer's own writes. A
    // build or a Dev Mode launch runs entirely in the main process, and one started from a recovery
    // window would compile a project whose services never loaded - producing a game missing most of
    // its content rather than failing. `WorkspaceFreezeService` normally reports this, and it is not
    // one of the services this mode starts.
    getInterface().workspace.reportWriteFreeze("recovery");

    const failures = await Service.initializeTolerant(
        ctx,
        RECOVERY_SHELL_SERVICES.map(service => ctx.services.get(service)),
    );

    for (const failure of failures) {
        reportWorkspaceAnomaly({
            source: "startup",
            operationKey: "workspace.recovery.operations.shellService",
            path: failure.service.constructor.name,
            error: failure.error,
            // Not `fatal`: in this mode nothing was. That is the distinction being drawn - the same
            // error that ends an ordinary boot is survivable here, and calling it fatal would say
            // the window failed to open while the author is reading it in the window.
            severity: "degraded",
        });
    }

    ctx.services.get<RecoveryService>(Services.Recovery).seedFromBoot(failures, ctx);
    return failures;
}
