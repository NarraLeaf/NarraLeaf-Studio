import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Workers, with the main process left a core to itself.
 *
 * Vitest's default is one worker per core, and the main process is not one of them - it is
 * where every module a worker imports gets transformed, and where the workers' results are
 * answered, both over the same RPC. That RPC gives up after sixty seconds. On a four-core CI
 * runner the suite reached it: every test passed and the run still failed, on
 * `Timeout calling "onTaskUpdate"` - an error that names no test, and which no amount of
 * reading the failing test tells you about. The slowest file in the suite is 64 seconds of
 * frame-by-frame weather rendering, and the next is 17, so the machine is genuinely saturated
 * while it runs.
 *
 * Two cores rather than one, because the transform side of that RPC is as much of the main
 * process's work as the reporting side. A developer machine loses one worker of many; the
 * runner keeps a core for the process that has to answer.
 */
const MAX_WORKERS = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 2);

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        environment: "node",
        passWithNoTests: true,
        maxWorkers: MAX_WORKERS,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src/renderer"),
            "@shared": path.resolve(__dirname, "src/shared"),
            "@services": path.resolve(__dirname, "src/renderer/lib/workspace/services"),
            // The bare specifier a runtime plugin entry imports. Supplied by an import map in a
            // real game environment and marked external at build time, so nothing on disk backs it
            // and a built-in plugin's runtime entry could not be tested at all without this.
            "narraleaf-studio/runtime": path.resolve(
                __dirname,
                "src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts",
            ),
        },
    },
});
