/**
 * Generates the host-API half of a script blueprint's declarations, from Studio's own source.
 *
 * A script blueprint is TypeScript the author writes in their own editor, and it needs two kinds of
 * declaration to be worth writing:
 *
 *  - **this file's output**, the host API and the three context tiers, which is the same for every
 *    project and so is generated once, here, and shipped as a resource;
 *  - `scripts/.narraleaf/project.d.ts`, this project's own names, which Studio writes when a
 *    project opens (see `@shared/project/scriptDeclarations`).
 *
 * Both land in `scripts/.narraleaf/` and are declared as the module `@narraleaf/script`, which is
 * why an author imports their types with no package installed and no `paths` mapping. The import is
 * always `import type`, so esbuild erases it and no build ever looks for a package to resolve.
 *
 * Generated from source rather than written by hand for the reason the plugin types package gives:
 * a declaration file maintained beside the code it describes is a second statement of it, and the
 * two drift. Run with `--check` in CI, the way the skeleton locale generator is.
 *
 *   node scripts/gen-script-api-dts.mjs             rewrite the resource
 *   node scripts/gen-script-api-dts.mjs --check     fail if it is stale
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { generateDtsBundle } = require("dts-bundle-generator");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

/** The module an author imports their types from. Scoped, so no package can take the name. */
const MODULE_SPECIFIER = "@narraleaf/script";

/**
 * Where the generated declarations live: a TypeScript module exporting the file's text.
 *
 * A module rather than a loose resource because the only consumer is Studio's renderer, which
 * writes the file into a project when one opens. A resource would have to travel through the main
 * process to get there; a module is simply imported, works the same in a test, and is checked in so
 * a fresh clone builds without running a generator.
 */
const OUTPUT = path.join(repoRoot, "src", "shared", "project", "scriptApiDeclarations.generated.ts");

/** The one entry: everything a script's ctx and handlers are made of. */
const ENTRY = path.join(repoRoot, "src/renderer/lib/ui-editor/blueprint-runtime/script/scriptEvents.ts");

/** Reuses the plugin package's generation config; see the comments in it for the two overrides. */
const TSCONFIG = path.join(repoRoot, "packages", "plugin-types", "tsconfig.gen.json");

const HEADER = `/**
 * Types for NarraLeaf Studio script blueprints.
 *
 * GENERATED FILE - do not edit. Written from Studio's own source by
 * scripts/gen-script-api-dts.mjs, and copied into your project by Studio.
 *
 * Import from "${MODULE_SPECIFIER}", always with \`import type\`:
 *
 *     import type { WidgetCtx, ScriptEvent } from "${MODULE_SPECIFIER}";
 *
 *     export function onMouseClick(ctx: WidgetCtx<"nl.button">, event: ScriptEvent<"mouseClick">) {
 *         ctx.host.devtools.log("info", "clicked");
 *     }
 */`;

function bundle() {
    const [text] = generateDtsBundle(
        [{
            filePath: ENTRY,
            output: { exportReferencedTypes: false, sortNodes: false, noBanner: true },
            // Inline the engine's own types rather than importing them. An author's `scripts/`
            // folder has no `narraleaf-react` installed, and a declaration file that imports one
            // resolves to nothing there - which shows up as `any` on a handful of text properties
            // rather than as an error, so it would not be noticed.
            libraries: { inlinedLibraries: ["narraleaf-react"] },
        }],
        { preferredConfigPath: TSCONFIG },
    );
    return text;
}

/**
 * Wrap the flat bundle in the module an author imports.
 *
 * An ambient module declaration rather than a package, so nothing has to be installed for the types
 * to resolve. `export` is kept on each declaration - inside `declare module` that is what makes a
 * name importable.
 */
function render(bundled) {
    const body = bundled
        .split("\n")
        // A bare `export {}` marks a file as a module and means nothing inside a declare block,
        // where it would instead make every declaration non-exported.
        .filter(line => line.trim() !== "export {};")
        .map(line => (line.length > 0 ? `    ${line}` : line))
        .join("\n")
        .trimEnd();
    return `${HEADER}\n\ndeclare module "${MODULE_SPECIFIER}" {\n${body}\n}\n`;
}

/** Wrap the declaration text in the module that carries it, as a single template literal. */
function renderModule(declarations) {
    const escaped = declarations
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
    return [
        "/**",
        " * The host API half of a script blueprint's declarations, as text.",
        " *",
        " * GENERATED FILE - do not edit. Written from Studio's own source by",
        " * scripts/gen-script-api-dts.mjs; run that script after changing the script context or event",
        " * types, and `--check` in CI reports it as stale otherwise.",
        " *",
        " * Studio writes this into `scripts/.narraleaf/script.d.ts` when a project opens.",
        " */",
        "",
        "export const SCRIPT_API_DECLARATIONS = `" + escaped + "`;",
        "",
    ].join("\n");
}

function main() {
    const rendered = renderModule(render(bundle()));

    const leaked = [...rendered.matchAll(/^\s+import .*from ['"]([^'"]+)['"]/gm)].map(match => match[1]);
    if (leaked.length > 0) {
        // A declaration that imports something resolves to `any` in a project that does not have
        // it, silently. Failing here is the only place that is visible.
        console.error(`Generated declarations still import: ${[...new Set(leaked)].join(", ")}`);
        console.error("Add the package to `inlinedLibraries`, or stop referencing its types.");
        process.exit(1);
    }

    if (check) {
        const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf-8") : null;
        if (current !== rendered) {
            console.error(`${path.relative(repoRoot, OUTPUT)} is out of date.`);
            console.error("Run: node scripts/gen-script-api-dts.mjs");
            process.exit(1);
        }
        console.log(`${path.relative(repoRoot, OUTPUT)} is up to date (${rendered.length} bytes).`);
        return;
    }

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, rendered);
    console.log(`Wrote ${path.relative(repoRoot, OUTPUT)} (${rendered.length} bytes).`);
}

main();
