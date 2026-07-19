/**
 * The versioned contract between Studio's repack and the prebuilt shell
 * templates (@narraleaf/studio-shell). The template package ships a
 * manifest.json of this shape; Studio validates its schemaVersion before
 * repacking so a Studio ↔ template version mismatch fails loudly ("Studio and
 * the shell template are incompatible") instead of silently misplacing bytes.
 *
 * This type is the authority: the shell repo's CI generates a manifest.json
 * that conforms to it (icon slot paths are enumerated from the actually-built
 * template, since AGP rewrites density directories). Studio only consumes the
 * declared paths - it hardcodes no template internals - so the repack stays
 * robust across template revisions that keep the schema.
 */

/** The schema version this Studio build understands. Bump on a breaking change. */
export const SUPPORTED_SHELL_MANIFEST_SCHEMA = 1;

/**
 * Screen orientation the shell locks the game to at runtime. Applied by the
 * shell (Android `setRequestedOrientation`) rather than patched into the
 * template's manifest, so the repack never has to touch orientation attributes.
 */
export type MobileShellOrientation = "landscape" | "portrait" | "auto";

/**
 * The shell-config.json the repack writes into the template and the shell reads
 * at startup. Its version is declared separately from the manifest's
 * (`shellConfigSchemaVersion`) because the two evolve independently: a template
 * can gain icon slots without changing what the shell reads at boot.
 *
 * `backgroundColor` is the pre-boot background - the same value the web shell's
 * entry document paints, so the native window, the document and the game agree
 * on the first frame instead of flashing white.
 */
export type MobileShellConfigV1 = {
    schemaVersion: number;
    orientation: MobileShellOrientation;
    backgroundColor: string;
};

export type ShellPlaceholderIdentity = {
    /** Reverse-domain id baked into the template, replaced during repack. */
    applicationId: string;
    label: string;
    versionCode: number;
    versionName: string;
};

export type AndroidShellTemplate = {
    /** Path of the release template APK inside the npm package. */
    template: string;
    /** Path of the debug-variant template APK. */
    templateDebug: string;
    minSdk: number;
    placeholders: ShellPlaceholderIdentity;
    /** Zip entry paths of the launcher-icon PNGs (one per density). */
    iconSlots: string[];
    /** Zip prefix the game site is injected under (e.g. "assets/www/"). */
    wwwRoot: string;
    /** Zip entry path shell-config.json is written to. */
    shellConfigPath: string;
};

export type IosShellTemplate = {
    template: string;
    templateDebug: string;
    /** Directory the template's .app content lives under (e.g. "Shell.app"). */
    appDirName: string;
    /** The Mach-O executable's name inside the .app (e.g. "Shell"). */
    executableName: string;
    placeholders: { bundleId: string };
    /** Icon PNG paths, relative to the .app directory. */
    iconSlots: string[];
    /** Path (relative to the .app) the game site is injected under (e.g. "www/"). */
    wwwRoot: string;
    /** Path (relative to the .app) shell-config.json is written to. */
    shellConfigPath: string;
};

export type MobileShellManifest = {
    schemaVersion: number;
    android: AndroidShellTemplate;
    ios: IosShellTemplate;
    /** Schema version of the shell-config.json payload Studio writes. */
    shellConfigSchemaVersion: number;
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(`Invalid shell template manifest: ${message}`);
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function validatePlaceholders(value: unknown): asserts value is ShellPlaceholderIdentity {
    assert(value && typeof value === "object", "placeholders missing");
    const p = value as Record<string, unknown>;
    assert(isNonEmptyString(p.applicationId), "placeholders.applicationId");
    assert(isNonEmptyString(p.label), "placeholders.label");
    assert(typeof p.versionCode === "number", "placeholders.versionCode");
    assert(isNonEmptyString(p.versionName), "placeholders.versionName");
}

function validateIconSlots(value: unknown, context: string): asserts value is string[] {
    assert(Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString), `${context}.iconSlots`);
}

/**
 * Validate a parsed manifest.json and narrow it to MobileShellManifest. The
 * schema-version check comes first: a mismatch is the "incompatible versions"
 * error, distinct from a structurally broken manifest of the right version.
 */
export function validateMobileShellManifest(value: unknown): MobileShellManifest {
    assert(value && typeof value === "object", "not an object");
    const m = value as Record<string, unknown>;
    if (m.schemaVersion !== SUPPORTED_SHELL_MANIFEST_SCHEMA) {
        throw new Error(
            `Shell template schema version ${String(m.schemaVersion)} is not supported by this Studio `
            + `(expected ${SUPPORTED_SHELL_MANIFEST_SCHEMA}); update Studio or the @narraleaf/studio-shell dependency.`,
        );
    }
    assert(typeof m.shellConfigSchemaVersion === "number", "shellConfigSchemaVersion");

    const android = m.android as Record<string, unknown> | undefined;
    assert(android && typeof android === "object", "android section missing");
    assert(isNonEmptyString(android.template), "android.template");
    assert(isNonEmptyString(android.templateDebug), "android.templateDebug");
    assert(typeof android.minSdk === "number", "android.minSdk");
    validatePlaceholders(android.placeholders);
    validateIconSlots(android.iconSlots, "android");
    assert(isNonEmptyString(android.wwwRoot), "android.wwwRoot");
    assert(isNonEmptyString(android.shellConfigPath), "android.shellConfigPath");

    const ios = m.ios as Record<string, unknown> | undefined;
    assert(ios && typeof ios === "object", "ios section missing");
    assert(isNonEmptyString(ios.template), "ios.template");
    assert(isNonEmptyString(ios.templateDebug), "ios.templateDebug");
    assert(isNonEmptyString(ios.appDirName), "ios.appDirName");
    assert(isNonEmptyString(ios.executableName), "ios.executableName");
    assert(ios.placeholders && typeof ios.placeholders === "object", "ios.placeholders");
    assert(isNonEmptyString((ios.placeholders as Record<string, unknown>).bundleId), "ios.placeholders.bundleId");
    validateIconSlots(ios.iconSlots, "ios");
    assert(isNonEmptyString(ios.wwwRoot), "ios.wwwRoot");
    assert(isNonEmptyString(ios.shellConfigPath), "ios.shellConfigPath");

    return value as MobileShellManifest;
}
