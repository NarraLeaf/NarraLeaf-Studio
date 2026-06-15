export type BlueprintScriptsCompileResult = {
    ok: boolean;
    errors: string[];
    /** blueprintId -> renderer-executable JavaScript. Intentionally empty until script modules run in a sandbox. */
    scripts: Record<string, string>;
};

/**
 * TypeScript blueprint source is project-controlled content. Dev Mode currently
 * runs with the normal renderer preload bridge, so sending compiled project
 * source to the renderer would allow that source to execute with access to
 * privileged IPC capabilities. Keep the Dev Mode bundle free of executable
 * blueprint scripts until script modules are evaluated in an isolated sandbox
 * with an explicit, least-privilege host API.
 */
export async function compileAllBlueprintScriptsForProject(_projectPath: string): Promise<BlueprintScriptsCompileResult> {
    return {
        ok: true,
        errors: [],
        scripts: {},
    };
}
