import path from "path";
import { describe, expect, it } from "vitest";
import { readCommandLineSigning } from "./commandLineSigning";

/**
 * The file system is reached through one injected probe, so these say what is on disk rather than
 * putting it there: the decisions under test are about the document, and a temp directory per case
 * would only slow them down.
 */
const DIRECTORY = path.join(path.sep === "\\" ? "D:\\" : "/", "jobs", "keys");
const PRESENT = new Set([
    path.join(DIRECTORY, "app.pfx"),
    path.join(DIRECTORY, "developer-id.p12"),
    path.join(DIRECTORY, "notary.p8"),
]);

function read(document: unknown, env: Record<string, string | undefined> = {}) {
    return readCommandLineSigning({
        document,
        directory: DIRECTORY,
        env,
        exists: async candidate => PRESENT.has(candidate),
    });
}

async function refusal(document: unknown, env: Record<string, string | undefined> = {}): Promise<string> {
    const result = await read(document, env);
    if (result.ok) {
        throw new Error("expected the file to be refused");
    }
    return result.reason;
}

describe("readCommandLineSigning", () => {
    it("resolves material against the file's own directory and takes a secret from the environment", async () => {
        const result = await read(
            { windows: { kind: "windows-pfx", file: "app.pfx", passwordEnv: "PFX_PASSWORD" } },
            { PFX_PASSWORD: "hunter2" },
        );

        expect(result).toEqual({
            ok: true,
            credentials: [{
                platform: "windows",
                kind: "windows-pfx",
                label: "windows-pfx (--build-signing)",
                material: {
                    id: "command-line:windows",
                    kind: "windows-pfx",
                    file: path.join(DIRECTORY, "app.pfx"),
                    password: "hunter2",
                },
            }],
        });
    });

    it("takes an inline secret, including an empty one", async () => {
        // A PFX with no password is a real thing. Treating "" as "not given" would send the caller
        // looking for a variable they deliberately did not set.
        const result = await read({ windows: { kind: "windows-pfx", file: "app.pfx", password: "" } });

        expect(result.ok && result.credentials[0].material).toMatchObject({ password: "" });
    });

    it("carries the notarization fields through as material and metadata", async () => {
        const result = await read({
            macos: {
                kind: "macos-apple",
                p12File: "developer-id.p12",
                p12Password: "secret",
                notaryKeyFile: "notary.p8",
                notaryKeyId: "ABCD1234",
                notaryIssuerId: "6a0e1111-2222-3333-4444-555566667777",
            },
        });

        expect(result.ok && result.credentials[0].material).toEqual({
            id: "command-line:macos",
            kind: "macos-apple",
            p12File: path.join(DIRECTORY, "developer-id.p12"),
            p12Password: "secret",
            notaryKeyFile: path.join(DIRECTORY, "notary.p8"),
            notaryKeyId: "ABCD1234",
            notaryIssuerId: "6a0e1111-2222-3333-4444-555566667777",
        });
    });

    it("keeps a credential that needs no file and no secret", async () => {
        const result = await read({ linux: { kind: "linux-gpg", keyId: "8A1C0000" } });

        expect(result.ok && result.credentials[0].material).toEqual({
            id: "command-line:linux",
            kind: "linux-gpg",
            keyId: "8A1C0000",
        });
    });

    it("reports the platforms in a fixed order however the file lists them", async () => {
        const result = await read({
            linux: { kind: "linux-gpg", keyId: "8A1C0000" },
            windows: { kind: "windows-pfx", file: "app.pfx", password: "x" },
        });

        expect(result.ok && result.credentials.map(credential => credential.platform)).toEqual(["windows", "linux"]);
    });

    it("refuses a key that is not a platform rather than ignoring it", async () => {
        expect(await refusal({ mac: { kind: "macos-keychain", identity: "Developer ID Application: X" } }))
            .toMatch(/names "mac", which is not a platform/);
    });

    it("refuses a credential whose kind signs something else", async () => {
        expect(await refusal({ windows: { kind: "linux-gpg", keyId: "8A1C0000" } }))
            .toMatch(/signs linux rather than windows/);
    });

    it("names the kinds a platform has when the kind is missing or unknown", async () => {
        expect(await refusal({ android: { file: "app.pfx" } })).toMatch(/android-keystore/);
        expect(await refusal({ windows: { kind: "windows-p12" } }))
            .toMatch(/windows-pfx, windows-store, windows-azure/);
    });

    it("refuses material that is not on disk, naming the path it looked at", async () => {
        expect(await refusal({ windows: { kind: "windows-pfx", file: "missing.pfx", password: "x" } }))
            .toBe(`The signing file's "windows" entry points "file" at a file that is not there: `
                + `${path.join(DIRECTORY, "missing.pfx")}`);
    });

    it("refuses a half-filled notarization", async () => {
        expect(await refusal({
            macos: {
                kind: "macos-apple",
                p12File: "developer-id.p12",
                p12Password: "secret",
                notaryKeyFile: "notary.p8",
                notaryKeyId: "ABCD1234",
            },
        })).toMatch(/missing notaryIssuerId/);
    });

    it("refuses a windows-store credential named by neither a subject nor a thumbprint", async () => {
        expect(await refusal({ windows: { kind: "windows-store" } }))
            .toMatch(/needs a subject name or a thumbprint/);
    });

    it("refuses an environment variable that is not set, rather than signing with nothing", async () => {
        expect(await refusal(
            { windows: { kind: "windows-pfx", file: "app.pfx", passwordEnv: "PFX_PASSWORD" } },
            { PFX_PASSWORD: "" },
        )).toMatch(/reads "password" from PFX_PASSWORD, which is not set/);
    });

    it("refuses a secret given both ways instead of picking one", async () => {
        expect(await refusal(
            { windows: { kind: "windows-pfx", file: "app.pfx", password: "a", passwordEnv: "PFX_PASSWORD" } },
            { PFX_PASSWORD: "b" },
        )).toMatch(/gives both "password" and "passwordEnv"/);
    });

    it("refuses a document that is not an object keyed by platform", async () => {
        expect(await refusal([])).toMatch(/keyed by platform/);
        expect(await refusal("windows")).toMatch(/keyed by platform/);
        expect(await refusal({})).toMatch(/names no credentials/);
    });
});
