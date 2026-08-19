import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        environment: "node",
        passWithNoTests: true,
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
