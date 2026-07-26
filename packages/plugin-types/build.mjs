/**
 * Generates the published declarations for the `narraleaf-studio` types package
 * directly from Studio's source, so the plugin API contract cannot drift from
 * the code that implements it.
 *
 *   narraleaf-studio/plugin   <- src/renderer/plugin/index.ts
 *   narraleaf-studio/runtime  <- src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts
 *
 * Both surfaces are bundled together into a single private dist/_api.d.ts, and
 * the two public entry points are thin re-export shims over it. That is not a
 * tidiness preference — it is load-bearing. Bundling the entries separately
 * gives each its own inlined copy of shared types like
 * BehaviorNodeExecutionContext, and because some of those carry private members
 * TypeScript compares them nominally. A BlueprintNodeDef from /plugin then fails
 * to satisfy RuntimeBlueprintNodeDef from /runtime with "two different types
 * with this name exist", which breaks the documented pattern of registering one
 * shared node definition from both entries.
 *
 * Run from the repository root (uses the root node_modules):
 *   yarn build:plugin-types            regenerate dist/
 *   yarn build:plugin-types --check    fail if dist/ is stale or unsound
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { generateDtsBundle } = require("dts-bundle-generator");
const ts = require("typescript");

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");
const genDir = path.join(packageDir, ".gen");
const tsconfigGen = path.join(packageDir, "tsconfig.gen.json");
const check = process.argv.includes("--check");

const SHARED_MODULE = "_api";

const ENTRIES = [
    {
        name: "plugin",
        specifier: "narraleaf-studio/plugin",
        source: path.join(repoRoot, "src/renderer/plugin/index.ts"),
        blurb: "Studio entry API - runs in the editor process.",
    },
    {
        name: "runtime",
        specifier: "narraleaf-studio/runtime",
        source: path.join(repoRoot, "src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts"),
        blurb: "Runtime entry API - runs inside the game (Dev Mode, Preview, Production).",
    },
];

const GENERATED_NOTE = "GENERATED FILE - do not edit. Produced from Studio's source by\n * packages/plugin-types/build.mjs. Regenerate with `yarn build:plugin-types`.";

function toPosix(value) {
    return value.split(path.sep).join("/");
}

/**
 * Resolve every name each entry actually exports, using the real type checker
 * rather than parsing the source. This has to be exact: a name missing here
 * silently disappears from the published API.
 */
function collectExports() {
    const configFile = ts.readConfigFile(tsconfigGen, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    }
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const checker = program.getTypeChecker();

    const result = new Map();
    for (const entry of ENTRIES) {
        const sourceFile = program.getSourceFile(entry.source);
        if (!sourceFile) {
            throw new Error(`Entry is not part of the compilation: ${entry.source}`);
        }
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) {
            throw new Error(`Entry has no module symbol (is it a module?): ${entry.source}`);
        }
        const names = checker.getExportsOfModule(moduleSymbol)
            .map(symbol => symbol.getName())
            .filter(name => name !== "default")
            .sort((a, b) => a.localeCompare(b));
        if (names.length === 0) {
            throw new Error(`Entry exports nothing: ${entry.source}`);
        }
        result.set(entry.name, names);
    }
    return result;
}

function buildSharedEntry(exportsByEntry) {
    // `export *` from both surfaces: if the same name were exported by both,
    // the star re-exports would silently cancel each other out and the name
    // would vanish from the published package. Fail instead.
    const [a, b] = ENTRIES;
    const overlap = exportsByEntry.get(a.name).filter(name => exportsByEntry.get(b.name).includes(name));
    if (overlap.length) {
        throw new Error(
            `${a.specifier} and ${b.specifier} both export: ${overlap.join(", ")}.\n` +
            "Ambiguous star re-exports would drop these names. Rename one side, or teach " +
            "this script to emit explicit per-entry re-exports.",
        );
    }

    fs.mkdirSync(genDir, { recursive: true });
    const rel = source => toPosix(path.relative(genDir, source)).replace(/\.tsx?$/, "");
    const content = `// GENERATED FILE - do not edit. Written by packages/plugin-types/build.mjs.
// Bundling both plugin API surfaces through one module keeps their shared
// types identical; see the header comment in build.mjs for why that matters.
export * from "${rel(a.source)}";
export * from "${rel(b.source)}";
`;
    const entryPath = path.join(genDir, "api.ts");
    fs.writeFileSync(entryPath, content);
    return entryPath;
}

function shim(entry, names) {
    const list = names.map(name => `\t${name},`).join("\n");
    return `/**
 * ${entry.specifier}
 *
 * ${entry.blurb}
 *
 * ${GENERATED_NOTE}
 */

export {
${list}
} from "./${SHARED_MODULE}.js";
`;
}

/**
 * Nothing here should ever execute: Studio resolves these specifiers through an
 * import map at load time. If it does run, the plugin failed to mark the
 * specifier external and bundled this stub instead - say so plainly rather than
 * failing later with a confusing undefined-is-not-a-function.
 */
function stub(entry) {
    return `// GENERATED FILE - do not edit.
throw new Error(
    "${entry.specifier} is a types-only package and has no runtime implementation. " +
    "Mark it as external in your bundler - NarraLeaf Studio provides the real module " +
    "at load time through an import map. See https://github.com/NarraLeaf/Plugins",
);
`;
}

/**
 * Verify the declarations stand on their own, and that a node definition from
 * the studio surface is still accepted by the runtime surface - the exact
 * cross-entry compatibility that separate bundles broke.
 */
function verify(dir) {
    const probePath = path.join(dir, "__verify.ts");
    const tsconfigPath = path.join(dir, "tsconfig.verify.json");

    fs.writeFileSync(probePath, `import type { BlueprintNodeDef } from "./plugin.js";
import type { RuntimeBlueprintNodeDef, RuntimePluginApp } from "./runtime.js";

// A shared node definition must satisfy both surfaces; this is the pattern the
// authoring guide tells plugins to use.
declare const shared: BlueprintNodeDef[];
declare const app: RuntimePluginApp;
const _runtimeAccepts: RuntimeBlueprintNodeDef[] = shared;
app.game.blueprintNodes.registerMany(shared);
export type { };
`);

    fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            lib: ["ESNext", "DOM"],
            strict: true,
            noEmit: true,
            // These files ARE the library, so leaving skipLibCheck on would
            // skip the only thing worth checking.
            skipLibCheck: false,
            noUnusedLocals: false,
            types: ["node"],
        },
        files: ["./plugin.d.ts", "./runtime.d.ts", "./__verify.ts"],
    }, null, 2));

    try {
        execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", tsconfigPath], {
            cwd: repoRoot,
            stdio: "pipe",
            encoding: "utf-8",
        });
        return null;
    } catch (error) {
        return `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    } finally {
        fs.rmSync(tsconfigPath, { force: true });
        fs.rmSync(probePath, { force: true });
    }
}

console.log("Resolving plugin API exports...");
const exportsByEntry = collectExports();
for (const entry of ENTRIES) {
    console.log(`  ${entry.specifier}: ${exportsByEntry.get(entry.name).length} exports`);
}

const sharedEntry = buildSharedEntry(exportsByEntry);
console.log("Bundling declarations...");
let bundled;
try {
    [bundled] = generateDtsBundle(
        [{
            filePath: sharedEntry,
            // Only what the entries explicitly export becomes public API.
            // Without this the bundler also exports every incidentally
            // referenced internal type, which both inflates the surface and
            // produces duplicate export names when two internals collide
            // (for example two unrelated types both called SelectOption).
            output: { exportReferencedTypes: false, sortNodes: false },
        }],
        { preferredConfigPath: tsconfigGen },
    );
} finally {
    fs.rmSync(genDir, { recursive: true, force: true });
}

const files = new Map();
files.set(`${SHARED_MODULE}.d.ts`, `/**
 * Shared implementation of both plugin API surfaces.
 *
 * Not a public entry point - import from "narraleaf-studio/plugin" or
 * "narraleaf-studio/runtime" instead.
 *
 * ${GENERATED_NOTE}
 */

${bundled}`);
for (const entry of ENTRIES) {
    files.set(`${entry.name}.d.ts`, shim(entry, exportsByEntry.get(entry.name)));
    files.set(`${entry.name}.js`, stub(entry));
}

if (check) {
    const stale = [];
    for (const [name, content] of files) {
        const current = path.join(distDir, name);
        if (!fs.existsSync(current) || fs.readFileSync(current, "utf-8") !== content) {
            stale.push(name);
        }
    }
    if (stale.length) {
        console.error(`dist/ is out of date: ${stale.join(", ")}`);
        console.error("Run: yarn build:plugin-types");
        process.exit(1);
    }
    const errors = verify(distDir);
    if (errors) {
        console.error(`Generated declarations do not typecheck:\n${errors}`);
        process.exit(1);
    }
    console.log("dist/ is up to date and typechecks.");
} else {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(distDir, { recursive: true });
    for (const [name, content] of files) {
        fs.writeFileSync(path.join(distDir, name), content);
    }

    const errors = verify(distDir);
    if (errors) {
        console.error(`Generated declarations do not typecheck:\n${errors}`);
        process.exit(1);
    }

    for (const name of [`${SHARED_MODULE}.d.ts`, ...ENTRIES.map(entry => `${entry.name}.d.ts`)]) {
        console.log(`  dist/${name}  ${files.get(name).split("\n").length} lines`);
    }
    console.log("Declarations generated and verified.");
}
