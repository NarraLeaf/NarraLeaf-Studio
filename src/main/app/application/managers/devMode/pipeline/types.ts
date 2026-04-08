import type { DevModeBundle } from "@shared/types/devMode";

/**
 * Abstraction for where Dev Mode loads UI assets from.
 * Current implementation: disk (`assembleDevModeBundleFromProjectPath`).
 * Future: live snapshot from Workspace via IPC.
 */
export interface DevModeBundleSource {
    readonly kind: string;
    load(context: DevModeBundleLoadContext): Promise<DevModeBundle>;
}

export type DevModeBundleLoadContext = {
    projectPath: string;
    bundleId: string;
    revision: number;
    compiled?: Record<string, unknown>;
    blueprintCompiledScripts?: Record<string, string>;
    blueprintScriptsCompileOk?: boolean;
    blueprintScriptsCompileErrors?: string[];
};
