import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SigningCredentialImport } from "@shared/types/signing";
import { SigningVault, type SecretSealer } from "./signingVault";

/**
 * Real temp directories, real files, no fs mocks: everything worth asserting
 * here is about what actually lands on disk. Only the OS keyring is faked - it
 * is Electron, and its whole point in these tests is to be switchable.
 */

const PASSWORD = "correct-horse-battery-staple";

/** Reversible stand-in for safeStorage. Distinguishable from plain text on sight. */
function fakeSealer(available = true): SecretSealer & { available: boolean } {
    const sealer = {
        available,
        isEncryptionAvailable: () => sealer.available,
        encryptString: (plainText: string) => Buffer.concat([Buffer.from("sealed:"), Buffer.from(plainText, "utf8")]),
        decryptString: (encrypted: Buffer) => {
            const text = encrypted.toString("utf8");
            if (!text.startsWith("sealed:")) {
                throw new Error("not sealed by this keyring");
            }
            return text.slice("sealed:".length);
        },
    };
    return sealer;
}

describe("SigningVault", () => {
    let tempDir: string;
    let root: string;
    let sourceDir: string;
    let pfxPath: string;
    let sealer: ReturnType<typeof fakeSealer>;
    let counter: number;

    function makeVault(withSealer: SecretSealer = sealer): SigningVault {
        return new SigningVault({
            root,
            sealer: withSealer,
            generateId: () => `cred-${++counter}`,
            now: () => new Date("2026-07-28T00:00:00.000Z"),
        });
    }

    // The concrete member, not the union: spreading a union widens it and the
    // `{ ...pfxImport(), file }` overrides below would stop type-checking.
    const pfxImport = (): Extract<SigningCredentialImport, { kind: "windows-pfx" }> => ({
        kind: "windows-pfx",
        label: "Release certificate",
        file: pfxPath,
        password: PASSWORD,
    });

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-signing-vault-"));
        root = path.join(tempDir, "signing");
        sourceDir = path.join(tempDir, "source");
        await fs.mkdir(sourceDir, { recursive: true });
        pfxPath = path.join(sourceDir, "release.pfx");
        await fs.writeFile(pfxPath, "pretend pkcs12 bytes");
        sealer = fakeSealer();
        counter = 0;
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("round-trips import, list, get and remove", async () => {
        const vault = makeVault();
        expect(await vault.list()).toEqual([]);

        const created = await vault.import(pfxImport());
        expect(created.kind).toBe("windows-pfx");
        expect(created.label).toBe("Release certificate");
        expect(created.createdAt).toBe("2026-07-28T00:00:00.000Z");
        expect(created.secretUnavailable).toBeUndefined();

        expect(await vault.list()).toEqual([created]);
        expect(await vault.get(created.id)).toEqual(created);
        expect(await vault.get("no-such-credential")).toBeNull();

        // A second vault over the same root sees it: the state is the files, not
        // anything held in memory.
        expect(await makeVault().list()).toEqual([created]);

        expect(await vault.remove(created.id)).toBe(true);
        expect(await vault.remove(created.id)).toBe(false);
        expect(await vault.list()).toEqual([]);
    });

    it("copies the key material in and leaves the original alone", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());

        const stored = vault.materialPath(credential, "file");
        expect(stored).not.toBeNull();
        expect(path.dirname(stored!)).toBe(path.join(root, "material", credential.id));
        expect(await fs.readFile(stored!, "utf8")).toBe("pretend pkcs12 bytes");

        // The credential names the copy, never the path the author picked - the
        // original may sit inside a version-controlled project directory.
        const named = (credential as { file: string }).file;
        expect(named).not.toContain(sourceDir);
        expect(path.isAbsolute(named)).toBe(false);

        // Moving the source away must not break the credential.
        await fs.rm(pfxPath);
        expect(await fs.readFile(vault.materialPath(credential, "file")!, "utf8")).toBe("pretend pkcs12 bytes");
    });

    it("deletes the copied material when the credential is removed", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());
        const materialDir = path.join(root, "material", credential.id);
        expect((await fs.readdir(materialDir)).length).toBe(1);

        await vault.remove(credential.id);
        await expect(fs.stat(materialDir)).rejects.toMatchObject({ code: "ENOENT" });
        // Removing a credential must not take the author's own file with it.
        expect(await fs.readFile(pfxPath, "utf8")).toBe("pretend pkcs12 bytes");
    });

    it("never serializes a password, on disk or through list()", async () => {
        const vault = makeVault();
        await vault.import(pfxImport());
        await vault.import({
            kind: "android-keystore",
            label: "Play release key",
            file: pfxPath,
            alias: "upload",
            storePassword: PASSWORD,
            keyPassword: "second-secret-value",
        });

        // The redacted shape that crosses IPC.
        const serializedList = JSON.stringify(await vault.list());
        expect(serializedList).not.toContain(PASSWORD);
        expect(serializedList).not.toContain("second-secret-value");
        expect(serializedList).not.toContain("secrets");

        // ...and the same for get().
        const credentials = await vault.list();
        for (const credential of credentials) {
            expect(JSON.stringify(await vault.get(credential.id))).not.toContain(PASSWORD);
        }

        // The file on disk holds ciphertext, not the password.
        const onDisk = await fs.readFile(path.join(root, "credentials.json"), "utf8");
        expect(onDisk).not.toContain(PASSWORD);
        expect(onDisk).not.toContain("second-secret-value");
        expect(onDisk).toContain("secrets");
    });

    it("hands back the secrets and absolute paths only through resolveMaterial", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());

        const resolved = await vault.resolveMaterial(credential.id);
        expect(resolved).not.toBeNull();
        expect(resolved).toMatchObject({ kind: "windows-pfx", id: credential.id, password: PASSWORD });
        const file = (resolved as { file: string }).file;
        expect(path.isAbsolute(file)).toBe(true);
        expect(await fs.readFile(file, "utf8")).toBe("pretend pkcs12 bytes");

        expect(await vault.resolveMaterial("no-such-credential")).toBeNull();
    });

    it("resolves every secret and metadata field of a multi-secret kind", async () => {
        const vault = makeVault();
        const credential = await vault.import({
            kind: "android-keystore",
            label: "Play release key",
            file: pfxPath,
            alias: "upload",
            storePassword: "store-secret",
            keyPassword: "key-secret",
        });

        expect(await vault.resolveMaterial(credential.id)).toMatchObject({
            kind: "android-keystore",
            alias: "upload",
            storePassword: "store-secret",
            keyPassword: "key-secret",
        });
    });

    it("refuses to persist the password when the keyring is unavailable, and says so", async () => {
        const unavailable = fakeSealer(false);
        const vault = makeVault(unavailable);
        const credential = await vault.import(pfxImport());

        // Flagged for preflight rather than silently stored in the clear.
        expect(credential.secretUnavailable).toBe(true);
        const onDisk = await fs.readFile(path.join(root, "credentials.json"), "utf8");
        expect(onDisk).not.toContain(PASSWORD);
        expect(onDisk).not.toContain("secrets");

        // The material is still usable; only the password is missing.
        const resolved = await vault.resolveMaterial(credential.id);
        expect(resolved).toMatchObject({ password: null });
        expect(await fs.readFile((resolved as { file: string }).file, "utf8")).toBe("pretend pkcs12 bytes");
    });

    it("degrades rather than throws when a sealed password cannot be opened", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());

        // The keyring going away (or the credential having been imported under a
        // different OS account) must not turn into an opaque build failure.
        const lost = fakeSealer();
        lost.available = false;
        expect(await makeVault(lost).resolveMaterial(credential.id)).toMatchObject({ password: null });

        const wrongKeyring: SecretSealer = {
            isEncryptionAvailable: () => true,
            encryptString: (plainText: string) => Buffer.from(plainText, "utf8"),
            decryptString: () => {
                throw new Error("decryption failed");
            },
        };
        expect(await makeVault(wrongKeyring).resolveMaterial(credential.id)).toMatchObject({ password: null });

        // Listing must survive it too.
        expect((await makeVault(wrongKeyring).list()).length).toBe(1);
    });

    it("answers whether the secrets can be unsealed without handing them over", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());
        expect(await vault.secretsAvailable(credential.id)).toBe(true);
        expect(await vault.secretsAvailable("no-such-credential")).toBe(false);

        // Imported while the keyring was down: nothing was ever sealed.
        const withoutKeyring = makeVault(fakeSealer(false));
        const unsealed = await withoutKeyring.import({ ...pfxImport(), label: "no keyring" });
        expect(await withoutKeyring.secretsAvailable(unsealed.id)).toBe(false);

        // Sealed fine, but this account cannot open it - which `secretUnavailable`
        // alone would not catch.
        const lost = fakeSealer();
        lost.available = false;
        expect(await makeVault(lost).secretsAvailable(credential.id)).toBe(false);

        // A kind with nothing to seal is trivially fine.
        const gpg = await vault.import({ kind: "linux-gpg", label: "Release key", keyId: "ABCD1234" });
        expect(await vault.secretsAvailable(gpg.id)).toBe(true);
    });

    it("rejects an import that is missing a required field, leaving nothing behind", async () => {
        const vault = makeVault();
        await expect(vault.import({ ...pfxImport(), label: "  " })).rejects.toThrow(/needs a name/);
        await expect(vault.import({ ...pfxImport(), file: "" })).rejects.toThrow(/required/);
        await expect(vault.import({
            kind: "windows-store",
            label: "Hardware token",
        } as SigningCredentialImport)).rejects.toThrow(/subject name or a thumbprint/);
        await expect(vault.import({ kind: "nonsense", label: "x" } as unknown as SigningCredentialImport))
            .rejects.toThrow(/Unknown signing credential kind/);

        expect(await vault.list()).toEqual([]);
        // No orphaned material directories from the failed attempts.
        const material = await fs.readdir(path.join(root, "material")).catch(() => []);
        expect(material).toEqual([]);
    });

    it("imports a macOS credential that notarizes nothing, and copies no .p8", async () => {
        // `notaryKeyFile` is an optional material field: the credential means
        // something coherent without it - sign, do not notarize - which is the
        // case the material loop had to learn to skip rather than demand.
        const vault = makeVault();
        const credential = await vault.import({
            kind: "macos-keychain",
            label: "My Developer ID",
            identity: "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)",
        });

        expect(credential).toMatchObject({ kind: "macos-keychain", identity: "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)" });
        expect(credential).not.toHaveProperty("notaryKeyFile");
        expect(await fs.readdir(vault.materialDir(credential.id))).toEqual([]);

        const material = await vault.resolveMaterial(credential.id);
        expect(material).toEqual({
            id: credential.id,
            kind: "macos-keychain",
            identity: "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)",
        });
    });

    it("copies the notary key in when a macOS credential does notarize", async () => {
        const vault = makeVault();
        const p8Path = path.join(sourceDir, "AuthKey_ABC123.p8");
        await fs.writeFile(p8Path, "pretend pkcs8 bytes");

        const credential = await vault.import({
            kind: "macos-apple",
            label: "Developer ID file",
            p12File: pfxPath,
            p12Password: PASSWORD,
            notaryKeyFile: p8Path,
            notaryKeyId: "ABC123",
            notaryIssuerId: "11111111-2222-3333-4444-555555555555",
        });

        const material = await vault.resolveMaterial(credential.id);
        expect(material).toMatchObject({
            kind: "macos-apple",
            p12Password: PASSWORD,
            notaryKeyId: "ABC123",
            notaryIssuerId: "11111111-2222-3333-4444-555555555555",
        });
        // The .p8 is a private key and lands under the same 0600 material
        // directory as every other key the vault holds.
        const notaryKeyFile = (material as { notaryKeyFile: string }).notaryKeyFile;
        expect(path.dirname(notaryKeyFile)).toBe(vault.materialDir(credential.id));
        expect(await fs.readFile(notaryKeyFile, "utf8")).toBe("pretend pkcs8 bytes");
    });

    it("refuses a half-filled notary set, leaving nothing behind", async () => {
        // Each of the three is individually optional, so nothing else rejects
        // this - and it is unambiguously a request to notarize. Accepting it
        // would give the author a credential that signs and silently skips the
        // step they asked for.
        const vault = makeVault();
        await expect(vault.import({
            kind: "macos-keychain",
            label: "Half",
            identity: "Developer ID Application: X",
            notaryKeyId: "ABC123",
        })).rejects.toThrow(/notaryKeyFile.*notaryIssuerId|notarizes/);

        expect(await vault.list()).toEqual([]);
        expect(await fs.readdir(path.join(root, "material")).catch(() => [])).toEqual([]);
    });

    it("cleans up the material when a source file cannot be copied", async () => {
        const vault = makeVault();
        await expect(vault.import({ ...pfxImport(), file: path.join(sourceDir, "absent.pfx") }))
            .rejects.toThrow();
        expect(await fs.readdir(path.join(root, "material")).catch(() => [])).toEqual([]);
        expect(await vault.list()).toEqual([]);
    });

    it("keeps kinds that carry no secret free of the unavailable flag", async () => {
        const vault = makeVault(fakeSealer(false));
        const credential = await vault.import({
            kind: "linux-gpg",
            label: "Release key",
            keyId: "ABCD1234",
        });
        // Nothing to seal, so an unavailable keyring is not a problem to report.
        expect(credential.secretUnavailable).toBeUndefined();
        expect(await vault.resolveMaterial(credential.id)).toEqual({
            kind: "linux-gpg",
            id: credential.id,
            keyId: "ABCD1234",
        });
    });

    it("drops unknown fields from an import payload", async () => {
        const vault = makeVault();
        const credential = await vault.import({
            kind: "linux-gpg",
            label: "Release key",
            keyId: "ABCD1234",
            // An import payload arrives over IPC; only whitelisted fields survive.
            secrets: { password: PASSWORD },
            evil: "../../escape",
        } as unknown as SigningCredentialImport);

        expect(JSON.stringify(credential)).not.toContain(PASSWORD);
        expect(credential).not.toHaveProperty("evil");
        expect(await fs.readFile(path.join(root, "credentials.json"), "utf8")).not.toContain("escape");
    });

    it("moves a corrupt index aside instead of overwriting it", async () => {
        const vault = makeVault();
        await vault.import(pfxImport());
        await fs.writeFile(path.join(root, "credentials.json"), "{ this is not json");

        // Starting empty is the only option, but the old file survives so the
        // orphaned material can still be traced back.
        expect(await vault.list()).toEqual([]);
        const aside = (await fs.readdir(root)).filter(name => name.includes("corrupt"));
        expect(aside.length).toBe(1);
        expect(await fs.readFile(path.join(root, aside[0]), "utf8")).toBe("{ this is not json");
    });

    it("keeps the readable credentials when one record is unusable", async () => {
        const vault = makeVault();
        const good = await vault.import(pfxImport());
        const indexPath = path.join(root, "credentials.json");
        const file = JSON.parse(await fs.readFile(indexPath, "utf8")) as { credentials: unknown[] };
        file.credentials.push({ id: "broken", kind: "not-a-kind", label: "x" });
        await fs.writeFile(indexPath, JSON.stringify(file));

        expect((await vault.list()).map(credential => credential.id)).toEqual([good.id]);
    });

    it("refuses material names that would escape the credential's directory", async () => {
        const vault = makeVault();
        const credential = await vault.import(pfxImport());
        const indexPath = path.join(root, "credentials.json");
        const file = JSON.parse(await fs.readFile(indexPath, "utf8")) as { credentials: { file: string }[] };
        file.credentials[0].file = path.join("..", "..", "..", "etc", "passwd");
        await fs.writeFile(indexPath, JSON.stringify(file));

        // credentials.json is a file on the author's disk; a hand-edited entry
        // must not become a path outside the vault.
        await expect(vault.resolveMaterial(credential.id)).rejects.toThrow(/outside its own directory/);
    });

    it("does not let concurrent imports lose a credential", async () => {
        const vault = makeVault();
        const imported = await Promise.all([
            vault.import({ ...pfxImport(), label: "one" }),
            vault.import({ ...pfxImport(), label: "two" }),
            vault.import({ ...pfxImport(), label: "three" }),
        ]);

        const listed = await vault.list();
        expect(listed.length).toBe(3);
        expect(new Set(listed.map(credential => credential.id))).toEqual(new Set(imported.map(c => c.id)));
    });

    it.skipIf(process.platform === "win32")("stores the index and the key material owner-only", async () => {
        // POSIX only: on win32 the mode bits are a no-op, and asserting them
        // there would only prove that Node reports what it invented.
        const vault = makeVault();
        const credential = await vault.import(pfxImport());

        const indexMode = (await fs.stat(path.join(root, "credentials.json"))).mode & 0o777;
        expect(indexMode).toBe(0o600);
        const materialMode = (await fs.stat(vault.materialPath(credential, "file")!)).mode & 0o777;
        expect(materialMode).toBe(0o600);

        // Rewriting must not widen it: writeFile only applies `mode` on create,
        // which is why the vault writes to a fresh temp file and renames.
        await vault.import({ ...pfxImport(), label: "second" });
        expect((await fs.stat(path.join(root, "credentials.json"))).mode & 0o777).toBe(0o600);
    });

    /**
     * Plugin build secrets share the index, the sealing and the file mode, and share nothing else:
     * what the project stores is a handle, and no read path but `resolvePluginSecret` answers a
     * value.
     */
    describe("plugin build secrets", () => {
        const TOKEN = "steam-build-token-4f2a";

        const indexText = () => fs.readFile(path.join(root, "credentials.json"), "utf8");

        it("seals the value and answers a handle to store", async () => {
            const vault = makeVault();
            const result = await vault.setPluginSecret(TOKEN);

            expect(result).toEqual({ handle: "cred-1", available: true });
            // The whole reason the project stores a handle: the value is not in the file.
            expect(await indexText()).not.toContain(TOKEN);
            await expect(vault.resolvePluginSecret("cred-1")).resolves.toBe(TOKEN);
        });

        it("answers availability without handing back the value", async () => {
            const vault = makeVault();
            const { handle } = await vault.setPluginSecret(TOKEN);

            await expect(vault.pluginSecretAvailable(handle)).resolves.toBe(true);
            // The state of a project a collaborator configured: the handle is in the document, the
            // secret is on their machine and not on this one.
            await expect(vault.pluginSecretAvailable("cred-does-not-exist")).resolves.toBe(false);
            await expect(vault.resolvePluginSecret("cred-does-not-exist")).resolves.toBeNull();
        });

        it("fills in a handle the project already refers to", async () => {
            const vault = makeVault();
            const result = await vault.setPluginSecret(TOKEN, "handle-from-a-collaborator");

            expect(result).toEqual({ handle: "handle-from-a-collaborator", available: true });
            await expect(vault.resolvePluginSecret("handle-from-a-collaborator")).resolves.toBe(TOKEN);
        });

        it("records the handle but not the value when the keyring refuses", async () => {
            const vault = makeVault(fakeSealer(false));
            const result = await vault.setPluginSecret(TOKEN);

            expect(result).toEqual({ handle: "cred-1", available: false });
            expect(await indexText()).not.toContain(TOKEN);
            await expect(vault.pluginSecretAvailable("cred-1")).resolves.toBe(false);
            await expect(vault.resolvePluginSecret("cred-1")).resolves.toBeNull();
        });

        it("drops the previous ciphertext when a re-set cannot seal", async () => {
            const shared = fakeSealer();
            const vault = makeVault(shared);
            const { handle } = await vault.setPluginSecret(TOKEN);

            shared.available = false;
            // A build must not quietly use the value the author has just replaced.
            await expect(vault.setPluginSecret("a different token", handle))
                .resolves.toEqual({ handle, available: false });

            shared.available = true;
            await expect(vault.resolvePluginSecret(handle)).resolves.toBeNull();
        });

        it("refuses a blank value: clearing is the project's business, not the vault's", async () => {
            const vault = makeVault();

            await expect(vault.setPluginSecret("")).rejects.toThrow(/needs a value/);
        });

        it("cannot masquerade as a signing credential", async () => {
            const vault = makeVault();
            const credential = await vault.import(pfxImport());
            const { handle } = await vault.setPluginSecret(TOKEN);

            await expect(vault.list()).resolves.toEqual([expect.objectContaining({ id: credential.id })]);
            await expect(vault.get(handle)).resolves.toBeNull();
            await expect(vault.resolveMaterial(handle)).resolves.toBeNull();
            // And the reverse: a credential id is not a handle.
            await expect(vault.resolvePluginSecret(credential.id)).resolves.toBeNull();
        });

        it("leaves the file as it was on a machine that has none", async () => {
            const vault = makeVault();
            await vault.import(pfxImport());

            expect(JSON.parse(await indexText())).not.toHaveProperty("pluginSecrets");
        });

        it("keeps the credentials when the stored secret list is unusable", async () => {
            const vault = makeVault();
            const credential = await vault.import(pfxImport());
            const file = JSON.parse(await indexText());
            await fs.writeFile(
                path.join(root, "credentials.json"),
                JSON.stringify({ ...file, pluginSecrets: "nonsense" }),
            );

            // Read as none rather than quarantined: the credentials point at key material on disk
            // that nothing else records, and a bad neighbouring field must not cost them.
            await expect(vault.list()).resolves.toEqual([expect.objectContaining({ id: credential.id })]);
            await expect(vault.pluginSecretAvailable("anything")).resolves.toBe(false);
        });
    });
});
