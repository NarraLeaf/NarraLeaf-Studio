import { describe, expect, it } from "vitest";
import { isVersioned } from "@shared/vcs/workingSet";
import { shouldExcludeProjectPackagePath } from "@shared/utils/projectPackage";
import {
    SCRIPTS_DIR,
    SCRIPTS_GENERATED_DIR,
    SCRIPTS_MODULES_DIR,
    SCRIPTS_TSCONFIG_FILE,
    isGeneratedScriptsPath,
    isScriptSourcePath,
    isScriptsPath,
    isStudioOwnedProjectPath,
    renderScriptsTsconfig,
    scriptLanguageOf,
} from "./scriptsDirectory";

/**
 * The ownership boundary, and the three other policies that have to agree with it.
 *
 * `scripts/` is the one directory a project holds that Studio does not own, and that only means
 * something if every path that walks a project agrees about what is in it. The interesting
 * assertions here are the cross-checks: a dependency tree that this module calls "not a script"
 * while version control calls it content is the failure this directory introduces, and it is
 * invisible until someone's first commit is four hundred megabytes.
 */

describe("the scripts directory", () => {
    it("recognises the author's own files as scripts", () => {
        expect(isScriptSourcePath("scripts/title.ts")).toBe(true);
        expect(isScriptSourcePath("scripts/menus/pause.ts")).toBe(true);
        expect(isScriptSourcePath("scripts/legacy/helpers.js")).toBe(true);
        // TypeScript is not compulsory, so which check a file gets is decided by extension alone.
        expect(scriptLanguageOf("scripts/title.ts")).toBe("typescript");
        expect(scriptLanguageOf("scripts/legacy/helpers.js")).toBe("javascript");
    });

    it("does not mistake configuration, declarations or dependencies for a script", () => {
        // Configuration, not code: nothing can bind an event to either.
        expect(isScriptSourcePath("scripts/package.json")).toBe(false);
        expect(isScriptSourcePath(`scripts/${SCRIPTS_TSCONFIG_FILE}`)).toBe(false);
        // Generated declarations are types, not handlers.
        expect(isScriptSourcePath(`scripts/${SCRIPTS_GENERATED_DIR}/project.d.ts`)).toBe(false);
        // A dependency's own source is not the author's script, at any depth.
        expect(isScriptSourcePath(`scripts/${SCRIPTS_MODULES_DIR}/left-pad/index.js`)).toBe(false);
        expect(isScriptSourcePath(`scripts/${SCRIPTS_MODULES_DIR}/a/node_modules/b/index.ts`)).toBe(false);
        // A file that merely ends in the extension somewhere else in the project is not one either.
        expect(isScriptSourcePath("editor/story/notes.ts")).toBe(false);
        expect(isScriptSourcePath("scripts")).toBe(false);
        // A dotfile named only by its extension has no name; `.ts` is not a script called nothing.
        expect(isScriptSourcePath("scripts/.ts")).toBe(false);
    });

    it("keeps Studio out of the directory except for what it generates", () => {
        // The whole point: a document service may not write the author's files back over them.
        expect(isStudioOwnedProjectPath("scripts/title.ts")).toBe(false);
        expect(isStudioOwnedProjectPath("scripts/package.json")).toBe(false);
        expect(isStudioOwnedProjectPath(`scripts/${SCRIPTS_MODULES_DIR}/left-pad/index.js`)).toBe(false);
        // The two exceptions, which Studio writes straight to disk with no copy behind them.
        expect(isStudioOwnedProjectPath(`scripts/${SCRIPTS_TSCONFIG_FILE}`)).toBe(true);
        expect(isStudioOwnedProjectPath(`scripts/${SCRIPTS_GENERATED_DIR}/project.d.ts`)).toBe(true);
        expect(isGeneratedScriptsPath(`scripts/${SCRIPTS_TSCONFIG_FILE}`)).toBe(true);
        expect(isGeneratedScriptsPath("scripts/title.ts")).toBe(false);
        // Everywhere else is Studio's, exactly as it was.
        expect(isStudioOwnedProjectPath("editor/ui/uidoc.json")).toBe(true);
        expect(isStudioOwnedProjectPath("assets/content/ab/cd/sprite.png")).toBe(true);
        expect(isScriptsPath("editor/story/index.json")).toBe(false);
        expect(isScriptsPath("scripts/title.ts")).toBe(true);
        // Either separator, because callers on Windows hold both spellings.
        expect(isScriptsPath("scripts\\title.ts")).toBe(true);
        // A directory whose name merely starts with the same letters is not this one.
        expect(isScriptsPath("scripts-old/title.ts")).toBe(false);
    });

    it("agrees with version control and with what an export carries", () => {
        // Three policies, three modules, one answer required. A script is content; a dependency
        // tree and the generated declarations are not.
        for (const scriptPath of ["scripts/title.ts", "scripts/menus/pause.js", "scripts/package.json"]) {
            expect(isScriptsPath(scriptPath), scriptPath).toBe(true);
            expect(isVersioned(scriptPath), scriptPath).toBe(true);
            expect(shouldExcludeProjectPackagePath(scriptPath), scriptPath).toBe(false);
        }
        for (const excluded of [
            `${SCRIPTS_DIR}/${SCRIPTS_MODULES_DIR}/left-pad/index.js`,
            `${SCRIPTS_DIR}/${SCRIPTS_GENERATED_DIR}/project.d.ts`,
        ]) {
            expect(isScriptSourcePath(excluded), excluded).toBe(false);
            expect(isVersioned(excluded), excluded).toBe(false);
            expect(shouldExcludeProjectPackagePath(excluded), excluded).toBe(true);
        }
    });

    it("generates a tsconfig that cannot make the type check compulsory", () => {
        const rendered = renderScriptsTsconfig();
        expect(rendered.startsWith("//")).toBe(true);
        expect(rendered).toContain("Edits are overwritten");

        const parsed = JSON.parse(rendered.slice(rendered.indexOf("{"))) as {
            compilerOptions: Record<string, unknown>;
            include: string[];
            exclude: string[];
        };
        // The load-bearing line. A build must never depend on a type check passing: esbuild strips
        // types without reading them, so a project whose scripts are JavaScript still builds. An
        // emitting tsconfig here would be the first step towards making TypeScript compulsory
        // after we said it was not.
        expect(parsed.compilerOptions.noEmit).toBe(true);
        // The two-tier check: `.ts` is checked, `.js` is inferred and never reported against.
        expect(parsed.compilerOptions.allowJs).toBe(true);
        expect(parsed.compilerOptions.checkJs).toBe(false);
        expect(parsed.compilerOptions.strict).toBe(true);
        // The generated declarations have to be in the program, or the editor resolves nothing.
        expect(parsed.include).toContain(`${SCRIPTS_GENERATED_DIR}/**/*.d.ts`);
        expect(parsed.include).toContain("**/*.ts");
        expect(parsed.include).toContain("**/*.js");
        expect(parsed.exclude).toContain(SCRIPTS_MODULES_DIR);
    });
});
