import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import {
    deriveGameAppId,
    GameBuildManager,
    gameFusesForPlatform,
    hasSigningIdentityForPlatform,
    isDesktopTarget,
    isMobileTarget,
    resolveElectronDistDirForApp,
    signingSecretsResolved,
    toWorkerAndroidSigning,
    toWorkerGpgSigning,
    toWorkerIosSigning,
    toWorkerWindowsSigning,
} from "./GameBuildManager";

// The fail-fast tests below reach run()'s console emission before throwing;
// keep it away from the window plumbing.
vi.mock("../../utils/workspaceConsole", () => ({
    emitWorkspaceConsoleLog: () => undefined,
}));

describe("deriveGameAppId", () => {
    it("uses a reverse-domain identifier verbatim", () => {
        expect(deriveGameAppId("com.studio.my-game", "My Game")).toBe("com.studio.my-game");
    });

    it("falls back to a namespaced id for non-domain identifiers", () => {
        expect(deriveGameAppId("My Game!!", "My Game")).toBe("com.narraleaf.games.my-game");
    });

    it("derives from the project name when no identifier is given", () => {
        expect(deriveGameAppId(undefined, "Épica 冒険")).toBe("com.narraleaf.games.epica-mou-xian");
    });

    it("keeps a safe trailing segment for punctuation-only names", () => {
        expect(deriveGameAppId("***", "***")).toBe("com.narraleaf.games.project");
    });
});

describe("isDesktopTarget", () => {
    it("claims desktop platforms only - not web, not mobile", () => {
        // Type-predicate bodies are unchecked by TypeScript; this pins the
        // classification so a revert to `platform !== "web"` fails a test
        // instead of silently routing mobile targets into electron-builder.
        const formats = { formats: [] };
        expect(isDesktopTarget({ platform: "windows", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "macos", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "linux", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "web", ...formats })).toBe(false);
        expect(isDesktopTarget({ platform: "android", ...formats })).toBe(false);
        expect(isDesktopTarget({ platform: "ios", ...formats })).toBe(false);
    });
});

describe("isMobileTarget", () => {
    it("claims mobile platforms only - not web, not desktop", () => {
        // Same reasoning as isDesktopTarget: a type-predicate body is unchecked,
        // and this one decides whether a target reaches the repack at all.
        const formats = { formats: [] };
        expect(isMobileTarget({ platform: "android", ...formats })).toBe(true);
        expect(isMobileTarget({ platform: "ios", ...formats })).toBe(true);
        expect(isMobileTarget({ platform: "web", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "windows", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "macos", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "linux", ...formats })).toBe(false);
    });
});

describe("GameBuildManager.start fail-fast guards", () => {
    const makeManager = () => new GameBuildManager({
        logger: { error: () => undefined },
    } as unknown as ConstructorParameters<typeof GameBuildManager>[0]);
    const entry = {} as GameRuntimeLaunchEntry;

    it("fails loudly for a platform outside the union", async () => {
        // Regression: with the explicit desktop/mobile/web partitions, an
        // unknown platform matches none of them - without this guard the
        // build would end "done" with zero artifacts.
        const manager = makeManager();
        const projectPath = path.join("/nonexistent", "unknown-platform-project");
        manager.start(projectPath, entry, {
            targets: [{ platform: "banana" as never, formats: ["zip"] }],
        });
        await vi.waitFor(() => {
            expect(manager.getStatus(projectPath).status).toBe("error");
        });
        expect(manager.getStatus(projectPath).error).toContain("banana");
    });
});

describe("gameFusesForPlatform", () => {
    it("hardens every platform against node/inspector abuse", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            const fuses = gameFusesForPlatform(platform, false);
            expect(fuses.runAsNode).toBe(false);
            expect(fuses.enableNodeOptionsEnvironmentVariable).toBe(false);
            expect(fuses.enableNodeCliInspectArguments).toBe(false);
            expect(fuses.onlyLoadAppFromAsar).toBe(true);
            expect(fuses.grantFileProtocolExtraPrivileges).toBe(false);
        }
    });

    it("leaves cookie encryption off to avoid a first-launch keychain prompt", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            expect(gameFusesForPlatform(platform, false).enableCookieEncryption).toBe(false);
        }
    });

    it("keeps asar integrity off on unsigned builds (downside-only footgun)", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            expect(gameFusesForPlatform(platform, false).enableEmbeddedAsarIntegrityValidation).toBe(false);
        }
    });

    it("enables asar integrity once signing is configured, except on Linux", () => {
        expect(gameFusesForPlatform("windows", true).enableEmbeddedAsarIntegrityValidation).toBe(true);
        expect(gameFusesForPlatform("macos", true).enableEmbeddedAsarIntegrityValidation).toBe(true);
        expect(gameFusesForPlatform("linux", true).enableEmbeddedAsarIntegrityValidation).toBe(false);
    });

    it("only re-signs on macOS", () => {
        expect(gameFusesForPlatform("macos", false).resetAdHocDarwinSignature).toBe(true);
        expect(gameFusesForPlatform("windows", false).resetAdHocDarwinSignature).toBe(false);
        expect(gameFusesForPlatform("linux", false).resetAdHocDarwinSignature).toBe(false);
    });
});

describe("resolveElectronDistDirForApp", () => {
    it("uses the embedded preview runner when packaged", () => {
        const app = {
            isPackaged: () => true,
            resolveResource: (rel: string) => path.join("/resources", rel),
        };
        expect(resolveElectronDistDirForApp(app)).toBe(path.join("/resources", "preview-runner", "dist"));
    });

    it("walks up from the running darwin binary in development", () => {
        const app = { isPackaged: () => false, resolveResource: (rel: string) => rel };
        const original = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin" });
        try {
            expect(resolveElectronDistDirForApp(app, "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"))
                .toBe("/repo/node_modules/electron/dist");
        } finally {
            Object.defineProperty(process, "platform", { value: original });
        }
    });
});

describe("hasSigningIdentityForPlatform", () => {
    const windowsPfx = {
        kind: "windows-pfx",
        id: "cred-win",
        file: "/vault/file-cert.pfx",
        password: "hunter2",
    } as const;

    it("earns the asar-integrity fuse only where a real signature seals it", () => {
        expect(hasSigningIdentityForPlatform("windows", { windows: windowsPfx })).toBe(true);
        expect(gameFusesForPlatform("windows", hasSigningIdentityForPlatform("windows", { windows: windowsPfx })))
            .toMatchObject({ enableEmbeddedAsarIntegrityValidation: true });
    });

    it("stays false for a platform this build did not sign", () => {
        expect(hasSigningIdentityForPlatform("windows", {})).toBe(false);
    });

    it("stays false on macOS and Linux even when other platforms are signed", () => {
        // macOS signing needs Apple tooling on a Mac (a separate batch), and a
        // Linux artifact's GPG signature is distribution integrity, not an
        // OS-enforced signature over the binary.
        const signing = { windows: windowsPfx, linux: { kind: "linux-gpg", id: "cred-gpg", keyId: "ABCD" } } as const;
        expect(hasSigningIdentityForPlatform("macos", signing)).toBe(false);
        expect(hasSigningIdentityForPlatform("linux", signing)).toBe(false);
    });
});

describe("signingSecretsResolved", () => {
    it("accepts material whose passwords all came back", () => {
        expect(signingSecretsResolved({ kind: "windows-pfx", id: "a", file: "/f.pfx", password: "pw" })).toBe(true);
        expect(signingSecretsResolved({
            kind: "android-keystore", id: "a", file: "/k.p12", alias: "release", storePassword: "s", keyPassword: "k",
        })).toBe(true);
    });

    it("rejects material with an unsealed password", () => {
        // null means the keyring refused, never that the password is empty -
        // continuing would carry a null into the worker and fail illegibly.
        expect(signingSecretsResolved({ kind: "windows-pfx", id: "a", file: "/f.pfx", password: null })).toBe(false);
        expect(signingSecretsResolved({
            kind: "android-keystore", id: "a", file: "/k.p12", alias: "release", storePassword: "s", keyPassword: null,
        })).toBe(false);
        expect(signingSecretsResolved({
            kind: "ios-apple", id: "a", p12File: "/i.p12", provisioningProfileFile: "/p.mp", p12Password: null,
        })).toBe(false);
    });

    it("passes the kinds that hold no secret at all", () => {
        expect(signingSecretsResolved({ kind: "windows-store", id: "a", sha1: "AA" })).toBe(true);
        expect(signingSecretsResolved({
            kind: "windows-azure",
            id: "a",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "acct",
            certificateProfileName: "profile",
            publisherName: "Studio",
        })).toBe(true);
        expect(signingSecretsResolved({ kind: "linux-gpg", id: "a", keyId: "ABCD" })).toBe(true);
    });
});

describe("signing material mapped for the worker", () => {
    it("maps a PFX onto electron-builder's signtool options", () => {
        expect(toWorkerWindowsSigning({ kind: "windows-pfx", id: "a", file: "/vault/cert.pfx", password: "pw" }))
            .toEqual({ source: "pfx", certificateFile: "/vault/cert.pfx", certificatePassword: "pw" });
    });

    it("carries a resolved signtool path when the host has one", () => {
        const mapped = toWorkerWindowsSigning(
            { kind: "windows-pfx", id: "a", file: "/vault/cert.pfx", password: "pw" },
            { signtoolPath: "C:/Windows Kits/signtool.exe" },
        );
        expect(mapped).toMatchObject({ signtoolPath: "C:/Windows Kits/signtool.exe" });
    });

    it("maps a certificate-store credential onto whichever selector it carries", () => {
        expect(toWorkerWindowsSigning({ kind: "windows-store", id: "a", subjectName: "Studio Ltd" }))
            .toEqual({ source: "certificate-store", certificateSubjectName: "Studio Ltd" });
        expect(toWorkerWindowsSigning({ kind: "windows-store", id: "a", sha1: "DEADBEEF" }))
            .toEqual({ source: "certificate-store", certificateSha1: "DEADBEEF" });
    });

    it("maps Azure without inventing Entra credentials", () => {
        // The Azure tooling reads those from the host environment; Studio holds
        // none of them, and the worker must not look for any.
        expect(toWorkerWindowsSigning({
            kind: "windows-azure",
            id: "a",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "acct",
            certificateProfileName: "profile",
            publisherName: "Studio Ltd",
        })).toEqual({
            source: "azure",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "acct",
            certificateProfileName: "profile",
            publisherName: "Studio Ltd",
        });
    });

    it("refuses a Windows mapping for a credential of another platform, or an unsealed one", () => {
        expect(toWorkerWindowsSigning({ kind: "linux-gpg", id: "a", keyId: "ABCD" })).toBeNull();
        expect(toWorkerWindowsSigning({ kind: "windows-pfx", id: "a", file: "/c.pfx", password: null })).toBeNull();
    });

    it("maps gpg to a key id and nothing more", () => {
        // The private key stays in the host's gpg-agent; there is deliberately
        // no secret to pass here.
        expect(toWorkerGpgSigning({ kind: "linux-gpg", id: "a", keyId: "ABCD1234" }))
            .toEqual({ keyId: "ABCD1234" });
        expect(toWorkerGpgSigning({ kind: "linux-gpg", id: "a", keyId: "ABCD", gpgPath: "/usr/bin/gpg" }))
            .toEqual({ keyId: "ABCD", gpgPath: "/usr/bin/gpg" });
        expect(toWorkerGpgSigning({ kind: "windows-pfx", id: "a", file: "/c.pfx", password: "pw" })).toBeNull();
    });

    it("hands the Android keystore over unopened, with both passwords", () => {
        expect(toWorkerAndroidSigning({
            kind: "android-keystore",
            id: "a",
            file: "/vault/release.p12",
            alias: "release",
            storePassword: "store",
            keyPassword: "key",
        })).toEqual({
            keystoreFile: "/vault/release.p12",
            alias: "release",
            storePassword: "store",
            keyPassword: "key",
        });
        expect(toWorkerAndroidSigning({
            kind: "android-keystore",
            id: "a",
            file: "/vault/release.p12",
            alias: "release",
            storePassword: null,
            keyPassword: "key",
        })).toBeNull();
    });

    it("maps the Apple identity with the profile that gets embedded", () => {
        expect(toWorkerIosSigning({
            kind: "ios-apple",
            id: "a",
            p12File: "/vault/apple.p12",
            provisioningProfileFile: "/vault/app.mobileprovision",
            p12Password: "pw",
        })).toEqual({
            p12File: "/vault/apple.p12",
            p12Password: "pw",
            provisioningProfileFile: "/vault/app.mobileprovision",
        });
        expect(toWorkerIosSigning({
            kind: "ios-apple",
            id: "a",
            p12File: "/vault/apple.p12",
            provisioningProfileFile: "/vault/app.mobileprovision",
            p12Password: null,
        })).toBeNull();
    });
});
