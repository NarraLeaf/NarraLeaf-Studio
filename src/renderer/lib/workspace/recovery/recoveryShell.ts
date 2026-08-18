import { Services, type WorkspaceContext } from "../services/services";
import { Service, type ServiceInitFailure } from "../services/Service";
import { RecoveryService } from "../services/core/RecoveryService";
import { freezeProjectWrites } from "@/lib/app/writeFreeze";
import { getInterface } from "@/lib/app/bridge";
import { reportWorkspaceAnomaly } from "./anomalyLog";

/**
 * The services a recovery shell brings up before the author sees anything.
 *
 * **The line this list draws is "the editor itself" versus "the author's project".** A recovery
 * window is a real workspace window - same title bar, same sidebar, same panels - so everything the
 * chrome reads has to be here or the window cannot draw. What is deliberately *not* here is the
 * document services: the story library, the cast, the interface documents, the localization and
 * voice libraries. Those are the ones that fail on a damaged project, and each is available on
 * demand as a load check (see `RecoveryService`), which is the better place for it - run by hand,
 * one at a time, with its failure shown next to the button that asked for it, and its panels
 * appearing only once it has actually loaded.
 *
 * Two entries are worth defending:
 *
 *  - `Assets`. It is a probe *and* it is here, because `UI` depends on it and there is no honest way
 *    to have a sidebar without a UI service. Its check is therefore seeded from this boot rather
 *    than waiting for a click, exactly as `Project`'s is.
 *  - `Preview`, `Build` and `ProjectDependency` do no project reads on init, and the status bar and
 *    action bar ask them for state on first paint.
 *
 * Absent for a different reason than the document services: `Search`, `Reference` and `ProjectStats`
 * all `depend` on the whole document graph, so including any of them would quietly load everything
 * this mode exists to load one piece at a time.
 */
export const RECOVERY_SHELL_SERVICES: readonly Services[] = [
  Services.FileSystem,
  Services.Uuid,
  Services.Project,
  Services.GlobalSettings,
  Services.ServiceAssets,
  Services.Assets,
  Services.UI,
  Services.PanelState,
  Services.Command,
  Services.DevMode,
  Services.Preview,
  Services.Build,
  Services.ProjectDependency,
  Services.Console,
  Services.SaveStatus,
  Services.WorkspaceReload,
  Services.WorkspaceFreeze,
  Services.VersionControl,
  Services.Recovery
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
 *
 * `reportCountsBefore` is captured across the whole boot so the checks can be seeded honestly: a
 * service that read a damaged file, reported it and carried on is not a service that succeeded, and
 * without this the panel would show a tick over its own report of the failure.
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
    RECOVERY_SHELL_SERVICES.map((service) => ctx.services.get(service))
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
      severity: "degraded"
    });
  }

  // Activated like an ordinary boot does. The status bar and action bar read Dev Mode, Preview and
  // Build for their first paint, and those only start polling here; a shell that skipped this
  // would draw a chrome permanently stuck on "unknown".
  for (const service of RECOVERY_SHELL_SERVICES.map((id) => ctx.services.get(id))) {
    if (!service.isInitialized(ctx)) {
      continue;
    }
    try {
      await service.activate(ctx);
    } catch (error) {
      reportWorkspaceAnomaly({
        source: "startup",
        operationKey: "workspace.recovery.operations.shellService",
        path: service.constructor.name,
        error,
        severity: "degraded"
      });
    }
  }

  ctx.services.get<RecoveryService>(Services.Recovery).seedFromBoot(failures, ctx);
  return failures;
}
