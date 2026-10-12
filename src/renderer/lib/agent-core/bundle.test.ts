/**
 * The agent core bundles for the browser, with nothing of Node's inside it.
 *
 * Studio's agent bridge runs the text formats' logic in the renderer, where there is no filesystem,
 * no `node:crypto` and no esbuild. The command lines that share that logic run in Node and are free
 * to use all three - in their own files (`project.ts`, `cli.ts`, `plugins.ts`). One import of either
 * from a pure module would make the renderer bundle fail to build, or worse, build with a stub that
 * fails at the first call, so this bundles `agent-core/index.ts` exactly as a browser target would
 * and refuses:
 *
 * - any import esbuild could not resolve for the browser (a Node built-in fails here: nothing is
 *   marked external, and the browser platform resolves none of them), and
 * - any input that is a Node built-in, esbuild itself, or one of the command lines' disk-facing files.
 *
 * Aliases and loaders are the ones `project/app/ui.js` bundles the command lines with.
 *
 * Comments in English per project convention.
 */

import { builtinModules } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const RENDERER = path.join(ROOT, "src", "renderer");

/** The files that are allowed Node, and so must never be reachable from the core. */
const NODE_ONLY_FILES = [
    "src/renderer/lib/ui-cli/project.ts",
    "src/renderer/lib/ui-cli/cli.ts",
    "src/renderer/lib/ui-cli/plugins.ts",
    "src/renderer/lib/story-cli/project.ts",
    "src/renderer/lib/story-cli/cli.ts",
    "src/renderer/lib/blueprint-cli/project.ts",
    "src/renderer/lib/blueprint-cli/cli.ts",
];

describe("the agent core", () => {
    it("bundles for the browser with no Node built-in, esbuild or command-line file reachable", async () => {
        const esbuild = await import("esbuild");
        const result = await esbuild.build({
            stdin: { contents: 'export * from "@/lib/agent-core";', resolveDir: RENDERER, loader: "ts" },
            bundle: true,
            write: false,
            metafile: true,
            platform: "browser",
            format: "esm",
            logLevel: "silent",
            alias: {
                "@": RENDERER,
                "@shared": path.join(ROOT, "src", "shared"),
                "@lib": path.join(RENDERER, "lib"),
                "@services": path.join(RENDERER, "lib", "workspace", "services"),
            },
            define: { __NLS_STUDIO_DEV__: "true" },
            loader: {
                ".css": "empty",
                ".ttf": "empty",
                ".woff": "empty",
                ".woff2": "empty",
                ".svg": "empty",
                ".png": "empty",
            },
        });
        expect(result.errors).toEqual([]);

        const inputs = Object.keys(result.metafile?.inputs ?? {});
        expect(inputs.length).toBeGreaterThan(0);
        const absolute = inputs.map(input => path.resolve(ROOT, input));

        expect(inputs.filter(input => input.startsWith("node:"))).toEqual([]);
        expect(absolute.filter(input => /node_modules[\\/]esbuild[\\/]/.test(input))).toEqual([]);
        const forbidden = new Set(NODE_ONLY_FILES.map(file => path.join(ROOT, file)));
        expect(absolute.filter(input => forbidden.has(input)).map(input => path.relative(ROOT, input))).toEqual([]);

        // esbuild lists a type-only import as an external one (it is dropped, not resolved), so the
        // externals are many and harmless - unless one names Node or esbuild, which would mean a
        // runtime import slipped through as a module the browser has to find on its own.
        const nodeExternals = Object.values(result.metafile?.inputs ?? {})
            .flatMap(input => input.imports)
            .filter(entry => entry.external)
            .map(entry => entry.path)
            .filter(name => name.startsWith("node:") || name === "esbuild" || builtinModules.includes(name.split("/")[0]));
        expect(nodeExternals).toEqual([]);
    }, 120_000);
});
