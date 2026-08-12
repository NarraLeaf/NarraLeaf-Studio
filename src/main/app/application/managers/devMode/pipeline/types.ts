import type { LocaleCode } from "@shared/i18n";
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
     * pick when nothing is being packaged. Both halves decide bytes: the *name* is what `AppTag`
     * folds to (`@shared/story/appTagFold`), so it must be the variant list's own spelling, and the
     * *id* is what a `/cut` row names, so it decides where this edition's story ends.
     */
    appTag?: { id: string; name: string };
    /**
     * Whether this pack ships third-party runtime code.
     *
     * Only one thing reads it: a plugin runs inside the game with the host API in reach, so it can
     * start any scene by a name nothing here can predict, and a pack that carries one has to keep
     * every scene. Absent is "no plugins", which is what Dev Mode and Preview mean.
     */
    hasRuntimePlugins?: boolean;
    /**
     * The language a failure this assembly reports is written in.
     *
     * Only the blueprint variant refusal uses it, and only a build ever supplies it: Dev Mode and the
     * preview never refuse, because neither of them packages anything. Absent falls back to English.
     */
    locale?: LocaleCode;
    /**
     * Reports a decision the author has to be told about - today, a story shipped whole because the
     * project can reach a scene by a name no static read resolves. Plain English, like every other
     * line the main process puts in the build console. Absent drops the line, which is what Dev Mode
     * and Preview want: neither drops a scene, so neither has anything to report.
     */
    onNotice?: (message: string) => void;
    compiled?: Record<string, unknown>;
    blueprintCompiledScripts?: Record<string, string>;
    blueprintScriptsCompileOk?: boolean;
    blueprintScriptsCompileErrors?: string[];
};
