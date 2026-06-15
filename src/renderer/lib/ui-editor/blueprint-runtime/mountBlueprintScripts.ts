import type { DevModeBundle } from "@shared/types/devMode";

declare global {
    // eslint-disable-next-line no-var
    var __NL_BP_MODULES__:
        | Record<string, { events: Record<string, unknown>; bound: Record<string, unknown> }>
        | undefined;
}

/**
 * Reset mounted TypeScript blueprint modules for the current Dev Mode bundle.
 *
 * The bundle may originate from project-controlled files, while Dev Mode uses
 * the normal renderer preload bridge. Do not evaluate bundle-provided script
 * text in this renderer; script modules must remain disabled until they can run
 * in an isolated sandbox with an explicit capability boundary.
 */
export function mountBlueprintCompiledScripts(_bundle: DevModeBundle): void {
    globalThis.__NL_BP_MODULES__ = {};
}
