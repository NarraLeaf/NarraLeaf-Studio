import { describe, expect, it } from "vitest";
import {
    SUPPORTED_SHELL_MANIFEST_SCHEMA,
    validateMobileShellManifest,
    type MobileShellManifest,
} from "./mobileShellManifest";

function validManifest(): MobileShellManifest {
    return {
        schemaVersion: SUPPORTED_SHELL_MANIFEST_SCHEMA,
        shellConfigSchemaVersion: 1,
        android: {
            template: "android/template.apk",
            templateDebug: "android/template-debug.apk",
            minSdk: 26,
            placeholders: {
                applicationId: "com.narraleaf.shell.placeholder",
                label: "NarraLeaf Shell",
                versionCode: 1,
                versionName: "0.0.0",
            },
            iconSlots: ["res/mipmap-mdpi-v4/ic_launcher.png", "res/mipmap-hdpi-v4/ic_launcher.png"],
            wwwRoot: "assets/www/",
            shellConfigPath: "assets/shell-config.json",
        },
        ios: {
            template: "ios/template.app.zip",
            templateDebug: "ios/template-debug.app.zip",
            appDirName: "Shell.app",
            executableName: "Shell",
            placeholders: { bundleId: "com.narraleaf.shell.placeholder" },
            iconSlots: ["AppIcon60x60@2x.png"],
            wwwRoot: "www/",
            shellConfigPath: "shell-config.json",
        },
    };
}

describe("validateMobileShellManifest", () => {
    it("accepts and narrows a well-formed manifest", () => {
        const manifest = validateMobileShellManifest(JSON.parse(JSON.stringify(validManifest())));
        expect(manifest.android.minSdk).toBe(26);
        expect(manifest.ios.appDirName).toBe("Shell.app");
    });

    it("rejects an unsupported schema version with a version-mismatch message", () => {
        const wrong = { ...validManifest(), schemaVersion: 2 };
        expect(() => validateMobileShellManifest(wrong)).toThrow(/schema version 2 is not supported/);
    });

    it("reports the schema mismatch before any structural check", () => {
        // A future manifest may be structurally different; the version tells the
        // user to update rather than drowning them in field errors.
        expect(() => validateMobileShellManifest({ schemaVersion: 99 })).toThrow(/not supported/);
    });

    it("rejects a manifest missing a required field", () => {
        const missingWww = validManifest();
        delete (missingWww.android as { wwwRoot?: string }).wwwRoot;
        expect(() => validateMobileShellManifest(missingWww)).toThrow(/android\.wwwRoot/);
    });

    it("rejects empty icon slots", () => {
        const noIcons = validManifest();
        noIcons.ios.iconSlots = [];
        expect(() => validateMobileShellManifest(noIcons)).toThrow(/ios\.iconSlots/);
    });

    it("rejects a non-object", () => {
        expect(() => validateMobileShellManifest(null)).toThrow(/not an object/);
        expect(() => validateMobileShellManifest("{}")).toThrow(/not an object/);
    });
});
