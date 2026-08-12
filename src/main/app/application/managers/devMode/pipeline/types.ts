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
    /**
     * The build variant these bytes are being produced as.
     *
     * Absent is the release variant, which is what Dev Mode and Preview pass: there is no variant to
     * pick when nothing is being packaged. It is the *name* the story documents are folded against
     * (`@shared/story/appTagFold`), so it must be the variant list's own spelling; the id travels
     * with it only so a caller can say which record this came from.
     */
    appTag?: { id: string; name: string };
    compiled?: Record<string, unknown>;
    blueprintCompiledScripts?: Record<string, string>;
    blueprintScriptsCompileOk?: boolean;
    blueprintScriptsCompileErrors?: string[];
};
