import type { DevModeBundle } from "@shared/types/devMode";
import { mountCompiledScripts } from "./script/scriptRuntime";

/**
 * Mount the script blueprints a bundle carries, replacing whatever was mounted before.
 *
 * The bundle holds each script as module text that esbuild produced from the author's own file in
 * `<project>/scripts/`; this turns it into a module and remembers it by blueprint id, so a
 * dispatched event can find the export it calls. See `script/scriptRuntime.ts` for how one is
 * loaded and what that does and does not isolate.
 *
 * This used to mount nothing at all. The comment where it did said script modules had to stay
 * disabled until they could run behind a capability boundary, and it was right about the shape of
 * the problem and wrong about which problem: what a project's code may do at all is now decided
 * before any of this, by the trust gate, and a script that runs here gets the same host API a
 * visual graph on the same slot gets - no more, and named by the same types.
 */
export async function mountBlueprintCompiledScripts(bundle: DevModeBundle): Promise<void> {
    await mountCompiledScripts(bundle.ui.scripts, (blueprintId, scriptRef, message) => {
        // The author's own code, failing while it is being evaluated. Their file, their message.
        console.error(`[blueprint script] ${scriptRef} failed to load: ${message}`);
    });
}
