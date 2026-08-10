import { afterEach, describe, expect, it } from "vitest";
import {
    describeMacSigning,
    describeWindowsSigning,
    isMacSigning,
    macSigningConfiguration,
    notarizationForTargets,
    signtoolPathForTargets,
    windowsSigningConfiguration,
    withNotarizationEnv,
    withSigntoolPath,
} from "./desktopSigning";
import type { GameBuildWorkerFuses, GameBuildWorkerNotarization, GameBuildWorkerTarget } from "./protocol";

/**
 * Pure option mapping: no signtool is executed here. The machine-level sign/verify
 * loop is exercised by hand against a real certificate.
 */

const FUSES: GameBuildWorkerFuses = {
    runAsNode: false,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: false,
};

function windowsTarget(signing?: GameBuildWorkerTarget["signing"]): GameBuildWorkerTarget {
    return { platform: "windows", formats: ["nsis"], arch: "x64", fuses: FUSES, ...(signing ? { signing } : {}) };
}

function macTarget(signing?: GameBuildWorkerTarget["signing"]): GameBuildWorkerTarget {
    return { platform: "macos", formats: ["dmg"], arch: "arm64", fuses: FUSES, ...(signing ? { signing } : {}) };
}

const NOTARIZATION: GameBuildWorkerNotarization = {
    keyFile: "/vault/AuthKey_ABC123.p8",
    keyId: "ABC123",
    issuerId: "11111111-2222-3333-4444-555555555555",
};

describe("windowsSigningConfiguration", () => {
    it("maps a PFX onto signtoolOptions", () => {
        const { win } = windowsSigningConfiguration({
            source: "pfx",
            certificateFile: "C:/vault/cert.pfx",
            certificatePassword: "s3cret",
            signtoolPath: "C:/kits/signtool.exe",
        });
        expect(win.signtoolOptions).toMatchObject({
            certificateFile: "C:/vault/cert.pfx",
            certificatePassword: "s3cret",
            signingHashAlgorithms: ["sha256"],
        });
        // signtoolPath travels as SIGNTOOL_PATH, not as a builder option: there
        // is no builder option for it.
        expect(win.signtoolOptions).not.toHaveProperty("signtoolPath");
        expect(win.azureSignOptions).toBeUndefined();
    });

    it("maps a certificate store credential by subject or by thumbprint", () => {
        const bySubject = windowsSigningConfiguration({
            source: "certificate-store",
            certificateSubjectName: "NarraLeaf Project",
        }).win;
        expect(bySubject.signtoolOptions).toMatchObject({ certificateSubjectName: "NarraLeaf Project" });
        expect(bySubject.signtoolOptions).not.toHaveProperty("certificateSha1");

        const bySha1 = windowsSigningConfiguration({
            source: "certificate-store",
            certificateSha1: "AB12",
        }).win;
        expect(bySha1.signtoolOptions).toMatchObject({ certificateSha1: "AB12" });
        expect(bySha1.signtoolOptions).not.toHaveProperty("certificateSubjectName");
    });

    it("maps Azure Trusted Signing onto azureSignOptions and nothing else", () => {
        const { win } = windowsSigningConfiguration({
            source: "azure",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "narraleaf",
            certificateProfileName: "public-trust",
            publisherName: "NarraLeaf Project",
        });
        expect(win.azureSignOptions).toEqual({
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "narraleaf",
            certificateProfileName: "public-trust",
            publisherName: "NarraLeaf Project",
        });
        // The one combination electron-builder resolves by silently preferring
        // Azure - which would sign with something other than what was chosen.
        expect(win.signtoolOptions).toBeUndefined();
    });

    it("passes an RFC 3161 server through only when the credential set one", () => {
        expect(windowsSigningConfiguration({
            source: "pfx",
            certificateFile: "cert.pfx",
            certificatePassword: "p",
            rfc3161TimeStampServer: "http://timestamp.example/tsa",
        }).win.signtoolOptions).toMatchObject({ rfc3161TimeStampServer: "http://timestamp.example/tsa" });

        expect(windowsSigningConfiguration({
            source: "pfx",
            certificateFile: "cert.pfx",
            certificatePassword: "p",
        }).win.signtoolOptions).not.toHaveProperty("rfc3161TimeStampServer");
    });

    it("keeps the password out of the build log line", () => {
        const line = describeWindowsSigning({
            source: "pfx",
            certificateFile: "C:/vault/cert.pfx",
            certificatePassword: "s3cret",
        });
        expect(line).not.toContain("s3cret");
        expect(line).not.toContain("cert.pfx");
    });
});

describe("isMacSigning", () => {
    it("tells the two platform unions apart by their source", () => {
        expect(isMacSigning({ source: "keychain", identity: "Developer ID Application: X" })).toBe(true);
        expect(isMacSigning({ source: "p12", certificateFile: "c.p12", certificatePassword: "x" })).toBe(true);
        expect(isMacSigning({ source: "pfx", certificateFile: "c.pfx", certificatePassword: "x" })).toBe(false);
        expect(isMacSigning({ source: "certificate-store", certificateSha1: "AB" })).toBe(false);
        expect(isMacSigning({
            source: "azure",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "a",
            certificateProfileName: "b",
            publisherName: "c",
        })).toBe(false);
    });
});

describe("macSigningConfiguration", () => {
    it("maps a keychain identity onto mac.identity", () => {
        const { mac } = macSigningConfiguration({
            source: "keychain",
            identity: "Developer ID Application: NarraLeaf (A1B2C3D4E5)",
        });
        expect(mac.identity).toBe("Developer ID Application: NarraLeaf (A1B2C3D4E5)");
        expect(mac).not.toHaveProperty("cscLink");
    });

    it("maps a .p12 onto cscLink, and does not also name an identity", () => {
        // The imported certificate is the only one in the throwaway keychain, so
        // a second way of naming it could only disagree with it.
        const { mac } = macSigningConfiguration({
            source: "p12",
            certificateFile: "/vault/developer-id.p12",
            certificatePassword: "s3cret",
        });
        expect(mac).toMatchObject({ cscLink: "/vault/developer-id.p12", cscKeyPassword: "s3cret" });
        expect(mac).not.toHaveProperty("identity");
    });

    it("says 'do not sign' out loud when nothing is configured", () => {
        // Left unset, electron-builder searches the login keychain and signs with
        // whatever it finds - a signed build on a machine that happens to hold a
        // certificate, which preflight has just called unsigned.
        expect(macSigningConfiguration(null).mac).toEqual({ identity: null, notarize: false });
    });

    it("turns notarization off unless the credential carries a key", () => {
        // Not a default: notarization is driven entirely by environment
        // variables, so an author with APPLE_ID exported for their own tooling
        // would otherwise have every build reach Apple uninvited.
        expect(macSigningConfiguration({ source: "keychain", identity: "X" }).mac.notarize).toBe(false);
        expect(macSigningConfiguration({
            source: "keychain",
            identity: "X",
            notarization: NOTARIZATION,
        }).mac.notarize).toBe(true);
    });
});

describe("describeMacSigning", () => {
    it("names the identity, and says whether Gatekeeper will still warn", () => {
        expect(describeMacSigning({ source: "keychain", identity: "Developer ID Application: X" }))
            .toContain("Developer ID Application: X");
        expect(describeMacSigning({ source: "keychain", identity: "X" })).toContain("not notarizing");
        expect(describeMacSigning({ source: "keychain", identity: "X", notarization: NOTARIZATION }))
            .toContain("notarizing");
    });

    it("never puts the certificate password in the log line", () => {
        // This channel goes straight to the author's console and into saved logs.
        expect(describeMacSigning({
            source: "p12",
            certificateFile: "/vault/developer-id.p12",
            certificatePassword: "s3cret",
        })).not.toContain("s3cret");
    });
});

describe("notarizationForTargets", () => {
    it("finds the credentials a macOS target carries", () => {
        expect(notarizationForTargets([
            windowsTarget({ source: "pfx", certificateFile: "c.pfx", certificatePassword: "x" }),
            macTarget({ source: "keychain", identity: "X", notarization: NOTARIZATION }),
        ])).toEqual(NOTARIZATION);
    });

    it("has none for an unsigned or merely-signed macOS target", () => {
        expect(notarizationForTargets([macTarget()])).toBeNull();
        expect(notarizationForTargets([macTarget({ source: "keychain", identity: "X" })])).toBeNull();
    });

    it("ignores a mac block that somehow landed on a non-macOS target", () => {
        // A manager bug rather than a shape the protocol allows; it must not
        // reach Apple with credentials meant for a target that is not there.
        expect(notarizationForTargets([
            windowsTarget({ source: "keychain", identity: "X", notarization: NOTARIZATION }),
        ])).toBeNull();
    });
});

describe("withNotarizationEnv", () => {
    const APPLE_VARS = [
        "APPLE_API_KEY",
        "APPLE_API_KEY_ID",
        "APPLE_API_ISSUER",
        "APPLE_ID",
        "APPLE_APP_SPECIFIC_PASSWORD",
        "APPLE_TEAM_ID",
        "APPLE_KEYCHAIN",
        "APPLE_KEYCHAIN_PROFILE",
    ] as const;
    const original = new Map(APPLE_VARS.map(name => [name, process.env[name]]));

    afterEach(() => {
        for (const [name, value] of original) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    it("exports the API key for the body and removes it again", async () => {
        for (const name of APPLE_VARS) {
            delete process.env[name];
        }
        const seen = await withNotarizationEnv(NOTARIZATION, async () => ({
            key: process.env.APPLE_API_KEY,
            id: process.env.APPLE_API_KEY_ID,
            issuer: process.env.APPLE_API_ISSUER,
        }));
        expect(seen).toEqual({
            key: "/vault/AuthKey_ABC123.p8",
            id: "ABC123",
            issuer: "11111111-2222-3333-4444-555555555555",
        });
        expect(process.env.APPLE_API_KEY).toBeUndefined();
    });

    it("clears the other Apple credential routes for the duration", async () => {
        // getNotarizeOptions checks APPLE_ID first and returns on the first
        // complete set it finds. An author with those exported would notarize
        // under an identity Studio was never given.
        process.env.APPLE_ID = "someone@example.com";
        process.env.APPLE_APP_SPECIFIC_PASSWORD = "abcd-efgh-ijkl-mnop";
        process.env.APPLE_TEAM_ID = "TEAM123";
        const seen = await withNotarizationEnv(NOTARIZATION, async () => process.env.APPLE_ID);
        expect(seen).toBeUndefined();
        expect(process.env.APPLE_ID).toBe("someone@example.com");
        expect(process.env.APPLE_APP_SPECIFIC_PASSWORD).toBe("abcd-efgh-ijkl-mnop");
    });

    it("restores the author's own values, even when the body throws", async () => {
        process.env.APPLE_API_KEY = "/mine/AuthKey.p8";
        await expect(withNotarizationEnv(NOTARIZATION, async () => {
            throw new Error("packaging failed");
        })).rejects.toThrow("packaging failed");
        expect(process.env.APPLE_API_KEY).toBe("/mine/AuthKey.p8");
    });

    it("leaves the environment untouched when nothing notarizes", async () => {
        process.env.APPLE_ID = "someone@example.com";
        const seen = await withNotarizationEnv(null, async () => process.env.APPLE_ID);
        expect(seen).toBe("someone@example.com");
    });
});

describe("signtoolPathForTargets", () => {
    it("finds the path a signtool-driven target carries", () => {
        expect(signtoolPathForTargets([
            { platform: "linux", formats: ["appimage"], arch: "x64", fuses: FUSES },
            windowsTarget({ source: "certificate-store", certificateSha1: "AB", signtoolPath: "C:/kits/signtool.exe" }),
        ])).toBe("C:/kits/signtool.exe");
    });

    it("is not confused by a macOS target's signing block", () => {
        // The two unions share the field name and not the field; reading
        // `signtoolPath` off a mac block would be a silent undefined at best.
        expect(signtoolPathForTargets([
            macTarget({ source: "p12", certificateFile: "/vault/c.p12", certificatePassword: "x" }),
        ])).toBeNull();
    });

    it("has none for an unsigned build, or for Azure (which does not use signtool)", () => {
        expect(signtoolPathForTargets([windowsTarget()])).toBeNull();
        expect(signtoolPathForTargets([windowsTarget({
            source: "azure",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "a",
            certificateProfileName: "b",
            publisherName: "c",
        })])).toBeNull();
    });
});

describe("withSigntoolPath", () => {
    const original = process.env.SIGNTOOL_PATH;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.SIGNTOOL_PATH;
        } else {
            process.env.SIGNTOOL_PATH = original;
        }
    });

    it("exports the path for the body and removes it again", async () => {
        delete process.env.SIGNTOOL_PATH;
        const seen = await withSigntoolPath("C:/kits/signtool.exe", async () => process.env.SIGNTOOL_PATH);
        expect(seen).toBe("C:/kits/signtool.exe");
        expect(process.env.SIGNTOOL_PATH).toBeUndefined();
    });

    it("restores an author's own value, even when the body throws", async () => {
        process.env.SIGNTOOL_PATH = "C:/mine/signtool.exe";
        await expect(withSigntoolPath("C:/kits/signtool.exe", async () => {
            throw new Error("packaging failed");
        })).rejects.toThrow("packaging failed");
        expect(process.env.SIGNTOOL_PATH).toBe("C:/mine/signtool.exe");
    });

    it("leaves the environment alone when the host has no signtool", async () => {
        process.env.SIGNTOOL_PATH = "C:/mine/signtool.exe";
        const seen = await withSigntoolPath(null, async () => process.env.SIGNTOOL_PATH);
        expect(seen).toBe("C:/mine/signtool.exe");
        expect(process.env.SIGNTOOL_PATH).toBe("C:/mine/signtool.exe");
    });
});
