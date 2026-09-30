/**
 * `<project>/scripts/` - the one directory in a project that Studio does not own.
 *
 * A script blueprint's source is a file the author edits in their own editor, so it cannot live
 * where Studio's documents live. Studio holds every document under `editor/` as an in-memory copy
 * and writes the whole copy back when it saves - and it saves everything before Dev Mode starts.
 * A file edited outside Studio and then written back from that copy is an edit silently undone,
 * which has happened once already with a project file edited on disk.
 *
 * So the boundary is drawn once, here, and it is a boundary of ownership rather than of file type:
 *
 *  - **Inside `scripts/`, the disk is authoritative.** Studio reads and watches; it never holds a
 *    copy to write back. The two generated files below are the exception, and they are generated
 *    *to* disk rather than edited through a document service.
 *  - **Outside `scripts/`, Studio is authoritative**, exactly as before.
 *
 * That one rule also answers what an author opens in Cursor or VS Code (this directory), who owns
 * which bytes, and why Studio offers "open in editor" rather than growing a script editor of its
 * own: a second editor over files the disk owns would be a second writer.
 *
 * # What is in here
 *
 *     <project>/scripts/
 *       package.json      the author's; Studio reads it and never writes it
 *       tsconfig.json     generated, with a do-not-edit header
 *       .narraleaf/       generated declarations - the project's own ids, as types
 *       node_modules/     the author's, from their own install
 *       **\/*.ts, *.js     the author's code
 *
 * `node_modules` is the author's to create: Studio never runs a package manager, because an install
 * runs its dependencies' `postinstall` scripts, and "the build executes no third-party code" is a
 * boundary this feature is not allowed to spend. Studio bundles what is already on disk - esbuild
 * reads those bytes, it does not execute them - and a missing dependency is reported as a
 * diagnostic naming the command to run.
 *
 * # Two reserved names, and nothing else
 *
 * `.narraleaf/` and `node_modules/` are the only names Studio claims inside `scripts/`. Everything
 * else is the author's to arrange, so there is no `game/` subdirectory to type: a script is
 * `scripts/title.ts`, or `scripts/menus/title.ts` if the author wants a folder.
 */

/** The directory itself, relative to the project root. */
export const SCRIPTS_DIR = "scripts";

/** The author's manifest. Read for its dependency list; never written. */
export const SCRIPTS_PACKAGE_FILE = "package.json";

/** Generated. Carries {@link SCRIPTS_TSCONFIG_HEADER} so a reader knows not to edit it. */
export const SCRIPTS_TSCONFIG_FILE = "tsconfig.json";

/** Generated declarations: the host API, and the project's own ids as literal types. */
export const SCRIPTS_GENERATED_DIR = ".narraleaf";

/** The author's dependency tree, which they install themselves. */
export const SCRIPTS_MODULES_DIR = "node_modules";

/**
 * What counts as a script.
 *
 * `.js` is here because TypeScript is not compulsory: esbuild strips types and never checks them,
 * so a `.js` file is a script that simply declined the type check. The two are told apart by
 * extension and nowhere else.
 */
export const SCRIPT_SOURCE_EXTENSIONS: readonly string[] = [".ts", ".js"];

/** Which type checking a file gets. `.js` is inferred from JSDoc and never reported against. */
export type ScriptLanguage = "typescript" | "javascript";

function splitRelative(relativePath: string): string[] {
    return relativePath
        .split(/[\\/]+/)
        .filter(segment => segment.length > 0 && segment !== ".");
}

/** Whether a project-relative path is inside the scripts directory at all. */
export function isScriptsPath(relativePath: string): boolean {
    return splitRelative(relativePath)[0] === SCRIPTS_DIR;
}

/**
 * Whether Studio generated this path and may therefore write it.
 *
 * The narrow hole in "the disk owns `scripts/`": the tsconfig and the declarations are Studio's
 * output, written straight to disk with no document copy behind them, and both carry a header or a
 * directory name saying so.
 */
export function isGeneratedScriptsPath(relativePath: string): boolean {
    const segments = splitRelative(relativePath);
    if (segments[0] !== SCRIPTS_DIR) {
        return false;
    }
    return (
        (segments.length === 2 && segments[1] === SCRIPTS_TSCONFIG_FILE) ||
        segments[1] === SCRIPTS_GENERATED_DIR
    );
}

/**
 * Whether a path is one of the author's script sources - the files a blueprint may point at.
 *
 * False inside both reserved directories: a declaration is not a script anyone can bind an event
 * to, and neither is a dependency's own source. False for `package.json` and the tsconfig, which
 * are configuration rather than code.
 */
export function isScriptSourcePath(relativePath: string): boolean {
    const segments = splitRelative(relativePath);
    if (segments[0] !== SCRIPTS_DIR || segments.length < 2) {
        return false;
    }
    if (segments.includes(SCRIPTS_MODULES_DIR) || segments[1] === SCRIPTS_GENERATED_DIR) {
        return false;
    }
    const name = segments[segments.length - 1];
    return SCRIPT_SOURCE_EXTENSIONS.some(extension => name.endsWith(extension) && name.length > extension.length);
}

/** Which type check a script source gets, by extension. */
export function scriptLanguageOf(relativePath: string): ScriptLanguage {
    return relativePath.endsWith(".ts") ? "typescript" : "javascript";
}

/**
 * Whether Studio's document layer owns this path and may write it through a service.
 *
 * The predicate a write path asks before it saves. Everything outside `scripts/` is Studio's as it
 * always was; inside, only what Studio itself generates.
 */
export function isStudioOwnedProjectPath(relativePath: string): boolean {
    return !isScriptsPath(relativePath) || isGeneratedScriptsPath(relativePath);
}

export const SCRIPTS_TSCONFIG_HEADER = [
    "// Written by NarraLeaf Studio. Edits are overwritten.",
    "//",
    "// It exists so an editor opening this folder resolves the generated declarations in",
    "// .narraleaf/ and type-checks your scripts the way Studio does. `npm install` and the",
    "// packages you add are yours; this file and .narraleaf/ are the only things Studio writes",
    "// in here.",
].join("\n");

/**
 * The generated `scripts/tsconfig.json`.
 *
 * `noEmit` is the load-bearing line. **A build must never depend on a type check passing**: esbuild
 * strips types without reading them, so a project whose scripts are JavaScript, or whose types are
 * momentarily wrong, still builds and still runs. `tsc` here is a lint that reports; it is not a
 * step in the pipeline, and wiring it into one would quietly make TypeScript compulsory after we
 * said it was not.
 *
 * `checkJs` is off for the same reason from the other side: a `.js` script gets inference and
 * completion from its JSDoc, and no errors it did not ask for.
 */
export function renderScriptsTsconfig(): string {
    const config = {
        compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            allowJs: true,
            checkJs: false,
            noEmit: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            types: [] as string[],
        },
        include: ["**/*.ts", "**/*.js", `${SCRIPTS_GENERATED_DIR}/**/*.d.ts`],
        exclude: [SCRIPTS_MODULES_DIR],
    };
    return `${SCRIPTS_TSCONFIG_HEADER}\n${JSON.stringify(config, null, 4)}\n`;
}
