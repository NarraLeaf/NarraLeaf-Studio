import type { LintReport } from "@/lib/lint";
import { LintService } from "@/lib/workspace/services/core/LintService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";

/**
 * The one entry point that starts a sweep, and the only thing that knows one is in flight.
 *
 * {@link LintService} announces a *finished* report (`onReportChanged`) and answers `isRunning()`
 * when asked, but never says "I started" - so a tab that only listened to the service would sit on
 * the previous report, or on "no problems found", for the whole of the next sweep. That is the one
 * state the report must never show: a stale clean bill while the sweep that would contradict it is
 * still running.
 *
 * So both entry points - the palette command and the tab's re-run control - go through here, and the
 * running flag is published from the same place the run is started. Module state is per window and a
 * window holds one project, which is the same scope the run belongs to.
 *
 * A second request while one is in flight joins the first rather than queueing another: the sweep
 * reads the project as it is now, so two overlapping ones would produce the same report twice at the
 * cost of doing everything twice.
 */

type RunningListener = (running: boolean) => void;

const listeners = new Set<RunningListener>();
let inFlight: Promise<LintReport> | null = null;

function publish(running: boolean): void {
  for (const listener of [...listeners]) {
    listener(running);
  }
}

export function isLintRunning(): boolean {
  return inFlight !== null;
}

export function subscribeLintRunning(listener: RunningListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Start a sweep, or hand back the one already running. Rejects the way `LintService.run` does. */
export function runProjectLint(ctx: WorkspaceContext): Promise<LintReport> {
  if (inFlight) {
    return inFlight;
  }
  const service = ctx.services.get<LintService>(Services.Lint);
  const started = service.run().finally(() => {
    inFlight = null;
    publish(false);
  });
  // The rejection is the caller's to report; this arm only keeps a caller-less failure from
  // surfacing as an unhandled rejection.
  started.catch(() => undefined);
  inFlight = started;
  publish(true);
  return started;
}
