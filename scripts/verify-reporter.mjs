/**
 * The vitest reporter `scripts/verify.mjs` runs beside the default one.
 *
 * It writes down which test files failed, which tests in them, and how many errors belonged to no
 * test at all, as JSON at the path in NLS_VERIFY_REPORT. The script needs those three facts to
 * decide what a red run means, and vitest's own JSON reporter cannot give the third: it counts an
 * unhandled error as neither a failed file nor a failed test, so a run whose only failure is one of
 * those reads as a success there while the process exits 1.
 */
import fs from "node:fs";

export default class VerifyReporter {
    onTestRunEnd(testModules, unhandledErrors) {
        const out = process.env.NLS_VERIFY_REPORT;
        if (!out) {
            return;
        }
        const failed = testModules
            .filter(module => module.state() === "failed")
            .map(module => ({
                file: module.moduleId,
                tests: [...module.children.allTests()]
                    .filter(test => test.result().state === "failed")
                    .map(test => test.fullName),
            }));
        fs.writeFileSync(out, JSON.stringify({ failed, unhandledErrors: unhandledErrors.length }));
    }
}
