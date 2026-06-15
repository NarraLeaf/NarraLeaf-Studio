import type { DevModeBundle } from "@shared/types/devMode";

declare global {
    // eslint-disable-next-line no-var
    var __NL_BP_MODULES__:
        | Record<string, { events: Record<string, unknown>; bound: Record<string, unknown> }>
        | undefined;
}

/**
 * Execute compiled TypeScript blueprint IIFEs from the Dev Mode bundle (Blueprint M5).
 */
export function mountBlueprintCompiledScripts(bundle: DevModeBundle): void {
    globalThis.__NL_BP_MODULES__ = {};
    const scripts = bundle.blueprintCompiledScripts ?? {};
    for (const js of Object.values(scripts)) {
        try {
            // esbuild iife runs immediately and registers modules on globalThis
            // eslint-disable-next-line no-eval
            (0, eval)(js);
        } catch (e) {
            console.error("[Blueprint] Failed to mount compiled script", e);
        }
    }
}
