/**
 * The vitest reporter `scripts/verify.mjs` runs beside the default one.
 *
 * It records failed tests, completed modules and unhandled errors at NLS_VERIFY_REPORT. Retrying
 * a failed file only proves it passed if the same tests actually ran; vitest's own JSON reporter
 * also counts an unhandled error as neither a failed file nor a failed test.
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
            .map(module => {
                const tests = [...module.children.allTests()].filter(test => test.result().state === "failed");
                return { file: module.moduleId, tests: tests.map(test => test.fullName), testIds: tests.map(test => test.id) };
            });
        const modules = testModules.map(module => ({
            file: module.moduleId,
            state: module.state(),
            passed: [...module.children.allTests()]
                .filter(test => test.result().state === "passed")
                .map(test => test.id),
        }));
        fs.writeFileSync(out, JSON.stringify({ failed, modules, unhandledErrors: unhandledErrors.length }));
    }
}
