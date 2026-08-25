import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { describe, expect, it } from "vitest";

/**
 * The game runtime's import boundary, checked at test time instead of only at the esbuild step.
 *
 * WHY THIS EXISTS
 * The runtime renderer bundle compiles part of the Studio renderer - most of `@/lib/ui-editor`,
 * a handful of shimmed modules, nothing else. An import that crosses that line is green under
 * tsc (the runtime tsconfig maps `@/*` at large) and green under vitest, and only fails when
 * someone builds a game. That is a slow way to find out, and it has reached `develop` before.
 *
 * HOW THE RULES ARE DERIVED - not duplicated
 * This file holds no copy of the allow list. It requires the real esbuild plugin from
 * project/build/runtime-alias-plugin.js, registers a fake `build` object to capture the
 * `onResolve` filter and callback it installs, and then asks THAT CALLBACK about every import
 * specifier found in the tree. The verdicts below are the plugin's own return values:
 *   - `{ errors: [...] }`  -> the build would fail, so the test fails
 *   - `{ path: <shim> }`   -> aliased away to a runtime-local shim
 *   - `undefined`          -> allowed through to the tsconfig path mapping
 * Adding a shim or an entry to `allowedExact` therefore relaxes this test automatically, and
 * renaming or removing the hook makes it throw rather than pass vacuously (see the assertions in
 * `loadRuntimeAliasRules`). The plugin is in a module of its own precisely so that requiring it
 * here does not drag esbuild, postcss and tailwind into the test process.
 *
 * WHAT IS SCANNED
 * Every module the runtime renderer entry actually reaches, walked from
 * src/runtime/renderer/index.tsx the way esbuild walks it. That is ~480 files, of which ~220 are
 * under src/renderer/lib/ui-editor - `widget-modules/`, `runtime/surface/`, `blueprint-nodes/`
 * and the rest - where the previous version of this test scanned only this one directory.
 *
 * It is deliberately NOT a listing of every file under src/renderer/lib/ui-editor. Roughly half
 * that tree (the inspectors, the outline panel, the docker bar, the editor commands) is
 * Studio-editor-only code that the runtime never bundles, is not subject to this boundary, and
 * does not obey it - a flat listing reports ~290 imports that break nothing. Reachability is the
 * scope the esbuild gate itself has, so this test fails exactly when the build would.
 *
 * Type-only imports are followed the way esbuild follows them, which is not at all: `import type`
 * is erased before resolution, so it can neither break the build nor pull a file into the graph.
 * They are still reported, against a frozen list that may shrink but not grow - see
 * KNOWN_TYPE_ONLY_COUPLINGS.
 */

const require_ = createRequire(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const RUNTIME_RENDERER_ENTRY = path.join(SRC_ROOT, "runtime", "renderer", "index.tsx");

/**
 * `import`/`export ... from "x"`, plus bare `import "x"` side-effect forms. Group 1 is the
 * `type` keyword when the whole clause is type-only.
 */
const IMPORT_PATTERN = /(?:import|export)\s+(type\s+)?(?:[^'"]*?from\s+)?["']([^"']+)["']/g;

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js"];
const INDEX_FILES = ["index.ts", "index.tsx"];

/**
 * Imports the runtime tolerates today only because TypeScript erases them. Each one still couples
 * a bundled module to Studio app code, so they are pinned rather than ignored: a new one fails
 * this test, and removing one of these means deleting the line.
 *
 * `FillLayer` wants the `ColorValue` interface that the properties framework defines. Its runtime
 * behaviour already comes from `colorUtils`, which IS shimmed; only the type crosses over.
 */
const KNOWN_TYPE_ONLY_COUPLINGS = [
    "renderer/lib/ui-editor/widget-modules/shared/chrome/FillLayer.tsx"
        + " imports @/apps/workspace/modules/properties/framework/types",
];

interface AliasRules {
    /** The specifiers the plugin inspects; everything else is none of its business. */
    readonly filter: RegExp;
    /** The plugin's own verdict for one specifier. */
    readonly resolve: (specifier: string) => { errors?: { text: string }[]; path?: string } | undefined;
}

/**
 * Load the shipped plugin and capture what it registers. Every assertion here is about the plugin
 * still having the shape this test drives it through: if `onResolve` moves, is renamed or stops
 * being installed, the test fails loudly instead of quietly checking nothing.
 */
function loadRuntimeAliasRules(): AliasRules {
    const { runtimeAliasPlugin } = require_(
        path.join(REPO_ROOT, "project", "build", "runtime-alias-plugin.js"),
    ) as { runtimeAliasPlugin?: () => { setup: (build: unknown) => void } };

    expect(typeof runtimeAliasPlugin, "project/build/runtime-alias-plugin.js must export runtimeAliasPlugin")
        .toBe("function");

    const registered: { filter?: RegExp; callback?: (args: { path: string; importer: string }) => unknown } = {};
    runtimeAliasPlugin!().setup({
        onResolve(options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => unknown) {
            expect(registered.filter, "the plugin registered more than one onResolve hook").toBeUndefined();
            registered.filter = options.filter;
            registered.callback = callback;
        },
    });

    expect(registered.filter, "the plugin no longer registers an onResolve hook").toBeInstanceOf(RegExp);
    // Sanity-check the captured hook against a specifier that must always be refused and one that
    // must always be allowed, so a plugin gutted to a no-op cannot make this suite pass.
    const refused = registered.callback!({ path: "@/apps/workspace/App", importer: "<test>" }) as
        { errors?: unknown[] } | undefined;
    expect(refused?.errors, "the plugin stopped refusing @/apps imports").toBeTruthy();
    expect(
        registered.callback!({ path: "@/lib/ui-editor/anything", importer: "<test>" }),
        "the plugin stopped allowing the shared ui-editor tree",
    ).toBeUndefined();

    return {
        filter: registered.filter!,
        resolve: specifier => registered.callback!({ path: specifier, importer: "<test>" }) as
            { errors?: { text: string }[]; path?: string } | undefined,
    };
}

/** Mirror of the tsconfig path mapping the runtime build uses (src/runtime/tsconfig.json). */
function resolveSpecifier(specifier: string, importer: string): string | null {
    let base: string | null = null;
    if (specifier.startsWith("@/")) {
        base = path.join(SRC_ROOT, "renderer", specifier.slice("@/".length));
    } else if (specifier.startsWith("@shared/")) {
        base = path.join(SRC_ROOT, "shared", specifier.slice("@shared/".length));
    } else if (specifier.startsWith("@services/")) {
        base = path.join(SRC_ROOT, "renderer", "lib", "workspace", "services", specifier.slice("@services/".length));
    } else if (specifier.startsWith(".")) {
        base = path.resolve(path.dirname(importer), specifier);
    }
    if (base === null) {
        return null; // A package, a stylesheet or a font: not ours to walk.
    }

    for (const extension of RESOLVE_EXTENSIONS) {
        const candidate = base + extension;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    for (const indexFile of INDEX_FILES) {
        const candidate = path.join(base, indexFile);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

interface Scan {
    readonly forbidden: string[];
    readonly typeOnly: string[];
    readonly visited: Set<string>;
}

function scanRuntimeGraph(rules: AliasRules): Scan {
    const forbidden: string[] = [];
    const typeOnly: string[] = [];
    const visited = new Set<string>();
    const queue = [RUNTIME_RENDERER_ENTRY];
    const describeFile = (file: string) => path.relative(SRC_ROOT, file).split(path.sep).join("/");

    while (queue.length > 0) {
        const file = queue.pop()!;
        if (visited.has(file) || !/\.tsx?$/.test(file)) {
            continue;
        }
        visited.add(file);

        const source = fs.readFileSync(file, "utf-8");
        for (const match of source.matchAll(IMPORT_PATTERN)) {
            const isTypeOnly = Boolean(match[1]);
            const specifier = match[2] ?? "";

            if (rules.filter.test(specifier)) {
                const verdict = rules.resolve(specifier);
                if (verdict?.errors?.length) {
                    const entry = `${describeFile(file)} imports ${specifier}`;
                    (isTypeOnly ? typeOnly : forbidden).push(entry);
                }
                if (verdict?.path) {
                    // Aliased to a runtime-local shim: the Studio module is never bundled, and the
                    // shim is walked in its place.
                    if (!isTypeOnly) {
                        queue.push(verdict.path);
                    }
                    continue;
                }
            }

            // `import type` is erased by the TypeScript front end, so esbuild never resolves it and
            // it never pulls a module into the bundle. Walking it would report files the build has
            // never seen.
            if (isTypeOnly) {
                continue;
            }
            const resolved = resolveSpecifier(specifier, file);
            if (resolved !== null) {
                queue.push(resolved);
            }
        }
    }

    return { forbidden, typeOnly, visited };
}

describe("game runtime import boundary", () => {
    // Walked once and shared: loading the plugin and reading ~500 files per test case would be
    // three times the work for the same answer. Lazy because `loadRuntimeAliasRules` asserts, and
    // assertions belong inside a test case.
    let cached: Scan | null = null;
    const scanned = (): Scan => (cached ??= scanRuntimeGraph(loadRuntimeAliasRules()));

    it("walks the whole runtime renderer graph, not just this directory", () => {
        const scan = scanned();
        const uiEditorPrefix = "renderer/lib/ui-editor/";
        const reachedUiEditor = [...scan.visited]
            .map(file => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
            .filter(file => file.startsWith(uiEditorPrefix));

        // A floor, not a target: it only has to be large enough that a walk which silently stopped
        // at the entry file - or at this directory, as the previous version of this test did -
        // cannot pass. Raise it if the reachable set shrinks legitimately.
        expect(reachedUiEditor.length).toBeGreaterThan(150);
        expect(scan.visited.size).toBeGreaterThan(300);
    });

    it("bundles no module the runtime alias plugin refuses", () => {
        expect([...new Set(scanned().forbidden)].sort()).toEqual([]);
    });

    it("adds no new type-only coupling to Studio app code", () => {
        expect([...new Set(scanned().typeOnly)].sort()).toEqual([...KNOWN_TYPE_ONLY_COUPLINGS].sort());
    });
});
