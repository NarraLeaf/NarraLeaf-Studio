import { afterEach, describe, expect, it } from "vitest";
import {
    describeWindowsSigning,
    signtoolPathForTargets,
    windowsSigningConfiguration,
    withSigntoolPath,
} from "./desktopSigning";
import type { GameBuildWorkerFuses, GameBuildWorkerTarget } from "./protocol";

/**
 * Pure option mapping: no signtool is executed here (see the probe scripts in
 * the plan for the machine-level sign/verify loop).
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

describe("signtoolPathForTargets", () => {
    it("finds the path a signtool-driven target carries", () => {
        expect(signtoolPathForTargets([
            { platform: "linux", formats: ["appimage"], arch: "x64", fuses: FUSES },
            windowsTarget({ source: "certificate-store", certificateSha1: "AB", signtoolPath: "C:/kits/signtool.exe" }),
        ])).toBe("C:/kits/signtool.exe");
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
