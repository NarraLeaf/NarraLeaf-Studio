import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMobileSigningIdentity } from "./mobileSigningIdentity";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function makeUserDataDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-userdata-"));
    tempDirs.push(dir);
    return dir;
}

const identityPath = (userDataDir: string) => path.join(userDataDir, "mobile-signing", "debug-identity.json");

describe("resolveMobileSigningIdentity", () => {
    it("creates a usable identity on first use", async () => {
        const userDataDir = await makeUserDataDir();
        const identity = await resolveMobileSigningIdentity(userDataDir);

        // Usable means node:crypto can actually load both halves - a
        // structurally-plausible-but-invalid identity would only fail later,
        // inside signing.
        expect(() => crypto.createPrivateKey(identity.privateKeyPem)).not.toThrow();
        const certificate = new crypto.X509Certificate(Buffer.from(identity.certificateDerBase64, "base64"));
        expect(certificate.subject).toContain("NarraLeaf Debug");
    });

    it("reuses the stored identity across calls", async () => {
        // Load-bearing: Android keys an installed app on package name AND
        // signature, so a fresh identity per build would make every rebuild
        // refuse to install over the last one.
        const userDataDir = await makeUserDataDir();
        const first = await resolveMobileSigningIdentity(userDataDir);
        const second = await resolveMobileSigningIdentity(userDataDir);
        expect(second).toEqual(first);
    });

    it("keeps the private key owner-only", async () => {
        const userDataDir = await makeUserDataDir();
        await resolveMobileSigningIdentity(userDataDir);
        const { mode } = await fs.stat(identityPath(userDataDir));
        expect(mode & 0o777).toBe(0o600);
    });

    it("regenerates a corrupt identity instead of failing inside the signer", async () => {
        const userDataDir = await makeUserDataDir();
        await fs.mkdir(path.dirname(identityPath(userDataDir)), { recursive: true });
        await fs.writeFile(identityPath(userDataDir), "{ truncated");
        const identity = await resolveMobileSigningIdentity(userDataDir);
        expect(() => crypto.createPrivateKey(identity.privateKeyPem)).not.toThrow();
    });

    it("regenerates a structurally wrong identity", async () => {
        const userDataDir = await makeUserDataDir();
        await fs.mkdir(path.dirname(identityPath(userDataDir)), { recursive: true });
        await fs.writeFile(identityPath(userDataDir), JSON.stringify({ privateKeyPem: "nonsense" }));
        const identity = await resolveMobileSigningIdentity(userDataDir);
        expect(identity.certificateDerBase64.length).toBeGreaterThan(0);
        expect(() => crypto.createPrivateKey(identity.privateKeyPem)).not.toThrow();
    });
});
