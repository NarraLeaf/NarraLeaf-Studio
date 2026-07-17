import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SUPPORTED_SHELL_MANIFEST_SCHEMA } from "../../../../buildWorker/mobile/mobileShellManifest";
import {
    loadMobileShellTemplate,
    mobileShellVariantForApp,
    resolveMobileShellDirForApp,
} from "./mobileShellTemplate";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** A template package tree on disk, seeded from a (possibly broken) manifest. */
async function makeTemplateDir(manifest: unknown, files = ["android/template.apk", "android/template-debug.apk", "ios/template.app.zip", "ios/template-debug.app.zip"]): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-shell-"));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    for (const file of files) {
        await fs.mkdir(path.join(dir, path.dirname(file)), { recursive: true });
        await fs.writeFile(path.join(dir, file), "template bytes");
    }
    return dir;
}

const validManifest = {
    schemaVersion: SUPPORTED_SHELL_MANIFEST_SCHEMA,
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
        iconSlots: ["res/mipmap-mdpi-v4/ic_launcher.png"],
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
    shellConfigSchemaVersion: 1,
};

describe("resolveMobileShellDirForApp", () => {
    it("uses the staged copy under resources when packaged", () => {
        const app = {
            isPackaged: () => true,
            resolveResource: (rel: string) => path.join("/Studio.app/Contents/Resources", rel),
        };
        expect(resolveMobileShellDirForApp(app)).toBe(path.join("/Studio.app/Contents/Resources", "mobile-shell"));
    });

    it("reads node_modules directly in development", () => {
        // resolveResource points into <root>/resources, so the package root is
        // its sibling. Pinning this keeps the dev track working without anyone
        // having to run the staging script first.
        const app = {
            isPackaged: () => false,
            resolveResource: (rel: string) => path.resolve("/repo/resources", rel),
        };
        expect(resolveMobileShellDirForApp(app)).toBe(path.resolve("/repo/node_modules/@narraleaf/studio-shell"));
    });
});

describe("mobileShellVariantForApp", () => {
    it("repacks the inspectable shell in development and never when packaged", () => {
        // The release shell disables WebView debugging; shipping Studio must
        // not hand players an inspectable build.
        expect(mobileShellVariantForApp({ isPackaged: () => false })).toBe("debug");
        expect(mobileShellVariantForApp({ isPackaged: () => true })).toBe("release");
    });
});

describe("loadMobileShellTemplate", () => {
    it("resolves the release variant's templates", async () => {
        const dir = await makeTemplateDir(validManifest);
        const template = await loadMobileShellTemplate(dir, "release");
        expect(template.variant).toBe("release");
        expect(template.androidTemplatePath).toBe(path.join(dir, "android/template.apk"));
        expect(template.iosTemplatePath).toBe(path.join(dir, "ios/template.app.zip"));
        expect(template.manifest.android.minSdk).toBe(26);
    });

    it("resolves the debug variant's templates", async () => {
        const dir = await makeTemplateDir(validManifest);
        const template = await loadMobileShellTemplate(dir, "debug");
        expect(template.androidTemplatePath).toBe(path.join(dir, "android/template-debug.apk"));
        expect(template.iosTemplatePath).toBe(path.join(dir, "ios/template-debug.app.zip"));
    });

    it("reports an incompatible template package distinctly from a broken one", async () => {
        const dir = await makeTemplateDir({ ...validManifest, schemaVersion: SUPPORTED_SHELL_MANIFEST_SCHEMA + 1 });
        await expect(loadMobileShellTemplate(dir, "release")).rejects.toThrow(/not supported by this Studio/);
    });

    it("rejects a manifest that does not meet the contract", async () => {
        const { iconSlots: _dropped, ...androidWithoutIcons } = validManifest.android;
        const dir = await makeTemplateDir({ ...validManifest, android: androidWithoutIcons });
        await expect(loadMobileShellTemplate(dir, "release")).rejects.toThrow(/android\.iconSlots/);
    });

    it("names the missing variant when a template file was not staged", async () => {
        // The staging script copies both variants; a partial copy must fail
        // loudly here rather than deep inside the repack.
        const dir = await makeTemplateDir(validManifest, ["android/template.apk", "ios/template.app.zip"]);
        await expect(loadMobileShellTemplate(dir, "debug")).rejects.toThrow(/Android debug shell template is missing/);
    });

    it("explains an uninstalled template package", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-shell-empty-"));
        tempDirs.push(dir);
        await expect(loadMobileShellTemplate(dir, "release")).rejects.toThrow(/not installed/);
    });

    it("rejects a corrupt manifest without leaking a parser stack", async () => {
        const dir = await makeTemplateDir("{ not json");
        await expect(loadMobileShellTemplate(dir, "release")).rejects.toThrow(/not valid JSON/);
    });
});

describe("the installed @narraleaf/studio-shell package", () => {
    // The contract this Studio enforces is only worth anything if the template
    // package it pins actually satisfies it. This is the dev-mode DoD: resolve
    // the real node_modules template and validate it.
    const packageDir = path.resolve(__dirname, "../../../../../../node_modules/@narraleaf/studio-shell");

    it("satisfies the manifest contract for both variants", async () => {
        for (const variant of ["release", "debug"] as const) {
            const template = await loadMobileShellTemplate(packageDir, variant);
            expect(template.manifest.schemaVersion).toBe(SUPPORTED_SHELL_MANIFEST_SCHEMA);
            expect(template.manifest.android.placeholders.applicationId).toBe("com.narraleaf.shell.placeholder");
            // AGP rewrites res/mipmap-<density>/ to -v4; the slots must come
            // from the built APK, not from source constants.
            expect(template.manifest.android.iconSlots.length).toBeGreaterThan(0);
            expect(template.manifest.ios.appDirName).toMatch(/\.app$/);
            await expect(fs.access(template.androidTemplatePath)).resolves.toBeUndefined();
            await expect(fs.access(template.iosTemplatePath)).resolves.toBeUndefined();
        }
    });
});
