import type { TranslationKey } from "@shared/i18n";
import { translate } from "@/lib/i18n";
import { CharacterService } from "../core/CharacterService";
import { ConsoleService } from "../core/ConsoleService";
import { Services, type WorkspaceContext } from "../services";
import { SaveStatusService, STORAGE_CONSOLE_CHANNEL } from "./SaveStatusService";

/**
 * Per-store ceiling on how long the flush waits.
 *
 * A store that has not answered in this long is not going to answer before the window closes, and
 * the alternative - waiting forever - is a window that will not close. Timing out does **not**
 * cancel the write; it only stops us blocking on it.
 */
export const FLUSH_STORE_TIMEOUT_MS = 5_000;

export type FlushPendingSavesResult = {
  /** True when every store answered and none of them rejected. */
  flushed: boolean;
  /** Human-readable store names that failed or timed out, for the console line. */
  failures: string[];
};

type FlushTarget = {
  labelKey: TranslationKey;
  flush: () => Promise<void>;
};

function withTimeout(promise: Promise<void>, timeoutMs: number, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${timeoutMs}ms`)),
      timeoutMs
    );
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Collect every store that owes the disk something.
 *
 * The auto-savers come from {@link SaveStatusService}, which every document service registers with.
 * {@link CharacterService} is listed separately because it predates the shared saver and still runs
 * its own (already bounded) timer.
 */
function collectTargets(ctx: WorkspaceContext): FlushTarget[] {
  const targets: FlushTarget[] = [];

  try {
    const saveStatus = ctx.services.get<SaveStatusService>(Services.SaveStatus);
    for (const { labelKey, saver } of saveStatus.listSavers()) {
      targets.push({ labelKey, flush: () => saver.flush() });
    }
  } catch {
    // No save-status service means no registered savers to flush.
  }

  try {
    const characters = ctx.services.get<CharacterService>(Services.Character);
    targets.push({
      labelKey: "workspace.shell.save.stores.characters",
      flush: () => characters.flushPendingChanges()
    });
  } catch {
    // Same.
  }

  return targets;
}

/**
 * Write out every pending auto-save and wait for all of them.
 *
 * This is what stands between "the user typed something 700ms ago" and "the window is gone". The
 * previous version of this function ({@link flushUIDocAndGraphIfDirty}) covered the UI document,
 * the graphs, the story and the characters - which meant Dev Mode and Preview were launching with
 * *stale localization, voice and variable data* every time, and a window close dropped the same
 * three on the floor.
 *
 * Two properties matter more than speed:
 *
 *  - **It never short-circuits.** `Promise.allSettled`, not `Promise.all`: the store whose disk is
 *    refusing must not stop the other six from reaching theirs.
 *  - **It always terminates.** Each store gets its own {@link FLUSH_STORE_TIMEOUT_MS}, because the
 *    callers block a window close or an app quit on the answer.
 *
 * Deliberately *not* wired to `beforeunload`. That event cannot await anything - every write here
 * is an async IPC round trip, so the handler would return before a single byte left the renderer -
 * and returning a value from it cancels the unload, which would turn quitting the app into a window
 * that refuses to go away. The main process asking over IPC and waiting for the reply
 * (`workspaceFlushPendingSaves`) is the only shape that can actually wait.
 */
export async function flushPendingSaves(
  ctx: WorkspaceContext,
  options: { timeoutMs?: number } = {}
): Promise<FlushPendingSavesResult> {
  const timeoutMs = options.timeoutMs ?? FLUSH_STORE_TIMEOUT_MS;
  const targets = collectTargets(ctx);

  const results = await Promise.allSettled(
    targets.map((target) => withTimeout(target.flush(), timeoutMs, translate(target.labelKey)))
  );

  const failures: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      const label = translate(targets[index].labelKey);
      failures.push(label);
      try {
        ctx.services.get<ConsoleService>(Services.Console).log(
          STORAGE_CONSOLE_CHANNEL,
          "error",
          translate("workspace.shell.save.flushFailed", {
            label,
            error: String((result.reason as Error)?.message ?? result.reason)
          }),
          { source: "Storage" }
        );
      } catch {
        // Reporting must not be the reason a shutdown flush throws.
      }
    }
  }

  return { flushed: failures.length === 0, failures };
}
