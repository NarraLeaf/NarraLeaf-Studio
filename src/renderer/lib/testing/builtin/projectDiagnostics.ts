// Type-only on purpose (the same call the build gate makes, for the same reason): a value import
// would pull the whole 26-rule registry - and every rule's dependencies - into the import graph of
// the registry that the picker touches on open. The instance comes off the service registry.
import type { LintService } from "@/lib/workspace/services/core/LintService";
import type { LintReportEntry } from "@/lib/lint/types";
import { Services } from "@/lib/workspace/services/services";
import type { TestDefinition, TestFinding } from "../types";
import type { BuiltInTestHost } from "./index";

/**
 * `narraleaf-studio:project-diagnostics` - phase 1's one built-in test (ruling R11).
 *
 * It is a wrapper, deliberately and completely: the 26 static rules are the existing project lint,
 * and this test calls the same engine the Project > Linting panel and the build gate call. Nothing
 * is reimplemented and nothing is added - a check that behaved differently depending on which of
 * three entry points ran it would be worse than not having the third one.
 *
 * It exists so the picker is not empty on merge and so the whole chain (register -> pick -> run ->
 * findings -> jump) is exercised by shipped code rather than only by a fixture. It is deliberately
 * *not* one of the two phase-2 tests.
 */

export const PROJECT_DIAGNOSTICS_TEST_ID = "narraleaf-studio:project-diagnostics";

/**
 * The i18n namespace this test's keys live under: `test.builtin.<slug>.*`.
 *
 * Written out literally and asserted against `deriveBuiltInTestSlug(id)` by the registry test, so
 * renaming the id cannot leave dead keys behind. Mirrors how every lint rule carries its slug.
 */
export const PROJECT_DIAGNOSTICS_SLUG = "projectDiagnostics";

export function createProjectDiagnosticsTest(host: BuiltInTestHost): TestDefinition {
  return {
    id: PROJECT_DIAGNOSTICS_TEST_ID,
    title: { key: "test.builtin.projectDiagnostics.title" },
    description: { key: "test.builtin.projectDiagnostics.description" },
    category: "integrity",
    // A sweep of documents already in memory: no window, and therefore runnable while the
    // workspace is frozen, exactly as `lint:project` is (ruling R9).
    presentation: "headless",
    // Not `project.read`: a built-in closes over the workspace directly, and `TestProjectHandle`
    // exists to give a *plugin* a bounded way in. Declaring it would claim a door it never uses.
    requires: [],
    async run(ctx) {
      const lint = host.services().get<LintService>(Services.Lint);

      const report = await lint.run({
        signal: ctx.signal,
        // The engine reports `done / total` over the scheduled rules, so this is a real
        // fraction rather than an invented one - the only case where a determinate bar is
        // honest. `label` is the rule id as a literal: it is an identifier, not prose.
        onProgress: (progress) =>
          ctx.progress({
            completed: progress.done,
            total: progress.total,
            label: { text: progress.ruleId }
          })
      });

      for (const entry of report.entries) {
        ctx.report(toFinding(entry));
      }

      // Reported before this line, kept after it: a cancelled run is still evidence, and the
      // findings the sweep did produce are on the record by now.
      //
      // The engine answers a cancelled sweep with a *partial* report rather than by throwing,
      // so without this a run the author stopped halfway would come back "passed" - a clean
      // bill from rules that never ran, which is precisely the state the engine's own
      // `skipped` list exists to prevent anyone claiming. Surfacing the abort as a rejection
      // is what makes the host record it as `cancelled` (ruling R4).
      ctx.signal.throwIfAborted();

      const params = { errors: report.counts.error, warnings: report.counts.warning };
      // `error` and nothing else decides the verdict: warnings are the project's own
      // configured opinion (a rule's severity is a settings row), and a test that failed on
      // one would be re-deciding a question the author already answered.
      return report.counts.error > 0
        ? {
            status: "failed",
            summary: { key: "test.builtin.projectDiagnostics.summary.failed", params }
          }
        : {
            status: "passed",
            summary: { key: "test.builtin.projectDiagnostics.summary.passed", params }
          };
    }
  };
}

/**
 * One lint entry as one finding.
 *
 * Straight through in every field that exists on both sides. `severity` in particular is *not*
 * re-derived: the engine already resolved it against the project's config table, and the ladders are
 * the same three words. `target` is passed on untouched because it is a `SearchJumpTarget` on both
 * sides, so the report tab's click-to-jump is existing machinery rather than a second navigation
 * layer that could disagree with the lint report's.
 */
function toFinding(entry: LintReportEntry): TestFinding {
  return {
    severity: entry.severity,
    message: { key: entry.messageKey, params: entry.messageParams },
    target: entry.target
  };
}
