import fs from "fs/promises";
import path from "path";
import type { App } from "@/app/app";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest,
// so a runtime (non-type) import through it would not resolve in tests.
import {
    validateMobileShellManifest,
    type MobileShellManifest,
} from "../../../../buildWorker/mobile/mobileShellManifest";

/**
 * Locating and validating the prebuilt mobile shell templates
 * (@narraleaf/studio-shell) that the repack turns into APK/IPA builds.
 *
 * The templates ship as a devDependency rather than a runtime one: Studio only
 * needs them when packaging (and in development), and asarUnpack copies
 * node_modules wholesale - a runtime dependency would ship the same ~1.5 MB
 * twice, once inside app.asar.unpacked and once under resources/. So packaged
 * Studio reads the copy staged by project/build/prepare-mobile-shell.js, and
 * development reads node_modules directly (no staging step to forget after a
 * dependency bump). Both roots hold the same package layout, so manifest.json -
 * which addresses its templates relative to the package root - reads the same
 * either way.
 */

type MobileShellResolverApp = Pick<App, "isPackaged" | "resolveResource">;

/**
 * Which template variant a repack starts from. The debug shell enables WebView
 * inspection (chrome://inspect, Safari Web Inspector); the release one does
 * not, which is why a packaged Studio must never reach for it.
 */
export type MobileShellVariant = "release" | "debug";

export type MobileShellTemplate = {
    /** Package root the manifest's relative paths resolve against. */
    dir: string;
    manifest: MobileShellManifest;
    variant: MobileShellVariant;
    /** Absolute path of this variant's Android template APK. */
    androidTemplatePath: string;
    /** Absolute path of this variant's iOS template `.app.zip`. */
    iosTemplatePath: string;
};

/**
 * Root of the shell template package. Packaged Studio reads the staged copy
 * under resources/; development resolves node_modules relative to the repo root
 * (resolveResource points into <root>/resources there, so its parent is the
 * root). `require.resolve` is not usable: the main process is bundled by
 * esbuild and this package is data, not code.
 */
export function resolveMobileShellDirForApp(app: MobileShellResolverApp): string {
    if (app.isPackaged()) {
        return app.resolveResource("mobile-shell");
    }
    return app.resolveResource(path.join("..", "node_modules", "@narraleaf", "studio-shell"));
}

/** Development repacks with the inspectable shell; a packaged Studio never does. */
export function mobileShellVariantForApp(app: Pick<App, "isPackaged">): MobileShellVariant {
    return app.isPackaged() ? "release" : "debug";
}

async function resolveTemplateFile(dir: string, relativePath: string, label: string): Promise<string> {
    const absolute = path.resolve(dir, relativePath);
    try {
        await fs.access(absolute);
    } catch {
        throw new Error(
            `The ${label} shell template is missing (${relativePath} under ${dir}). `
            + "Reinstall dependencies, or run project/build/prepare-mobile-shell.js to stage the templates.",
        );
    }
    return absolute;
}

/**
 * Read and validate the shell template manifest, resolving the given variant's
 * template paths. Every failure is loud: a schema mismatch means Studio and the
 * template package disagree about the contract, and a missing file means the
 * staging step did not run - both would otherwise surface as a corrupt artifact
 * much later.
 */
export async function loadMobileShellTemplate(
    dir: string,
    variant: MobileShellVariant,
): Promise<MobileShellTemplate> {
    const manifestPath = path.join(dir, "manifest.json");
    let raw: string;
    try {
        raw = await fs.readFile(manifestPath, "utf8");
    } catch {
        throw new Error(
            `The mobile shell templates are not installed (no manifest.json under ${dir}). `
            + "Reinstall dependencies, or run project/build/prepare-mobile-shell.js to stage the templates.",
        );
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`The shell template manifest is not valid JSON (${manifestPath}): ${String(error)}`);
    }
    const manifest = validateMobileShellManifest(parsed);
    const [androidTemplatePath, iosTemplatePath] = await Promise.all([
        resolveTemplateFile(
            dir,
            variant === "debug" ? manifest.android.templateDebug : manifest.android.template,
            `Android ${variant}`,
        ),
        resolveTemplateFile(
            dir,
            variant === "debug" ? manifest.ios.templateDebug : manifest.ios.template,
            `iOS ${variant}`,
        ),
    ]);
    return { dir, manifest, variant, androidTemplatePath, iosTemplatePath };
}

/** Convenience for the manager: resolve, then load, in one step. */
export function loadMobileShellTemplateForApp(app: MobileShellResolverApp): Promise<MobileShellTemplate> {
    return loadMobileShellTemplate(resolveMobileShellDirForApp(app), mobileShellVariantForApp(app));
}
