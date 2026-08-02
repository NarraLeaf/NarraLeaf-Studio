import { describe, expect, it } from "vitest";
import { SIGNING_CREDENTIAL_KINDS } from "@shared/types/signing";
import {
    buildSigningImport,
    importFieldNames,
    importFieldsFor,
    isImportComplete,
    requiredVaultFields,
    type SigningImportDraft,
} from "./buildSigningImport";

/** A draft with every box filled, so a test can knock one out at a time. */
const FULL: Record<string, SigningImportDraft> = {
    "windows-pfx": { label: "Release", file: "C:/keys/release.pfx", password: "pfx-secret" },
    "windows-store": { label: "Token", subjectName: "NarraLeaf Ltd", sha1: "AABB" },
    "windows-azure": {
        label: "Cloud",
        endpoint: "https://eus.codesigning.azure.net",
        codeSigningAccountName: "narraleaf",
        certificateProfileName: "public",
        publisherName: "CN=NarraLeaf",
    },
    "android-keystore": {
        label: "Play",
        file: "C:/keys/release.jks",
        storePassword: "store-secret",
        keyPassword: "key-secret",
        alias: "release",
    },
    "macos-keychain": {
        label: "Mac",
        identity: "Developer ID Application: NarraLeaf (A1B2C3D4E5)",
        notaryKeyFile: "/keys/AuthKey_ABC123.p8",
        notaryKeyId: "ABC123",
        notaryIssuerId: "11111111-2222-3333-4444-555555555555",
    },
    "macos-apple": {
        label: "Mac file",
        p12File: "/keys/developer-id.p12",
        p12Password: "p12-secret",
        notaryKeyFile: "/keys/AuthKey_ABC123.p8",
        notaryKeyId: "ABC123",
        notaryIssuerId: "11111111-2222-3333-4444-555555555555",
    },
    "ios-apple": {
        label: "Apple",
        p12File: "C:/keys/apple.p12",
        p12Password: "p12-secret",
        provisioningProfileFile: "C:/keys/app.mobileprovision",
    },
    "linux-gpg": { label: "GPG", keyId: "0xDEADBEEF", gpgPath: "C:/gpg/gpg.exe" },
};

/** The three notary rows, cleared. Notarization is optional on both macOS kinds. */
const NO_NOTARIZATION = { notaryKeyFile: "", notaryKeyId: "", notaryIssuerId: "" };

describe("importFieldsFor", () => {
    it("asks for every field the vault will demand", () => {
        // The vault throws on a missing material or secret field, and the throw
        // reaches the author as a raw error string. A form that cannot collect
        // one of them is a dead end, so the two lists are held together here
        // rather than discovered at import time.
        for (const kind of SIGNING_CREDENTIAL_KINDS) {
            expect(importFieldNames(kind), kind).toEqual(expect.arrayContaining(requiredVaultFields(kind)));
        }
    });

    it("never asks for the label twice - the form owns that row", () => {
        for (const kind of SIGNING_CREDENTIAL_KINDS) {
            expect(importFieldNames(kind), kind).not.toContain("label");
        }
    });

    it("points the alias picker at the keystore and the password that opens it", () => {
        const alias = importFieldsFor("android-keystore").find(field => field.type === "alias");

        expect(alias).toMatchObject({ type: "alias", fileField: "file", passwordField: "storePassword" });
        // Both have to be collected before the picker can list anything, so they
        // must come earlier in the form.
        const names = importFieldNames("android-keystore");
        expect(names.indexOf("alias")).toBeGreaterThan(names.indexOf("file"));
        expect(names.indexOf("alias")).toBeGreaterThan(names.indexOf("storePassword"));
    });
});

describe("isImportComplete", () => {
    it("accepts a fully filled form for every kind", () => {
        for (const kind of SIGNING_CREDENTIAL_KINDS) {
            expect(isImportComplete(kind, FULL[kind]), kind).toBe(true);
        }
    });

    it("always needs a name", () => {
        for (const kind of SIGNING_CREDENTIAL_KINDS) {
            expect(isImportComplete(kind, { ...FULL[kind], label: "   " }), kind).toBe(false);
        }
    });

    it("refuses a keystore with no key chosen", () => {
        expect(isImportComplete("android-keystore", { ...FULL["android-keystore"], alias: "" })).toBe(false);
        expect(isImportComplete("android-keystore", { ...FULL["android-keystore"], file: "" })).toBe(false);
    });

    it("lets the key password stand in for the store password", () => {
        expect(isImportComplete("android-keystore", { ...FULL["android-keystore"], keyPassword: "" })).toBe(true);
    });

    it("takes either half of a Windows certificate-store credential, but not neither", () => {
        expect(isImportComplete("windows-store", { label: "Token", subjectName: "NarraLeaf Ltd" })).toBe(true);
        expect(isImportComplete("windows-store", { label: "Token", sha1: "AABB" })).toBe(true);
        expect(isImportComplete("windows-store", { label: "Token" })).toBe(false);
    });

    it("does not require the optional gpg path", () => {
        expect(isImportComplete("linux-gpg", { label: "GPG", keyId: "0xDEADBEEF" })).toBe(true);
        expect(isImportComplete("linux-gpg", { label: "GPG" })).toBe(false);
    });

    it("accepts a macOS credential that does not notarize", () => {
        // Notarization is the optional half. A Mac build signed and not
        // notarized is a real, buildable thing - it just warns on first launch.
        expect(isImportComplete("macos-keychain", { ...FULL["macos-keychain"], ...NO_NOTARIZATION })).toBe(true);
        expect(isImportComplete("macos-apple", { ...FULL["macos-apple"], ...NO_NOTARIZATION })).toBe(true);
    });

    it("refuses a half-filled notary set, which the vault would reject anyway", () => {
        // Each row is individually optional, so nothing else here would catch
        // this - and it is unambiguously a request to notarize.
        for (const field of ["notaryKeyFile", "notaryKeyId", "notaryIssuerId"] as const) {
            expect(isImportComplete("macos-apple", { ...FULL["macos-apple"], [field]: "" }), field).toBe(false);
        }
    });

    it("still requires the parts a macOS credential cannot do without", () => {
        expect(isImportComplete("macos-keychain", { ...FULL["macos-keychain"], identity: "" })).toBe(false);
        expect(isImportComplete("macos-apple", { ...FULL["macos-apple"], p12File: "" })).toBe(false);
        expect(isImportComplete("macos-apple", { ...FULL["macos-apple"], p12Password: "" })).toBe(false);
    });
});

describe("buildSigningImport", () => {
    it("builds the payload each kind declares", () => {
        expect(buildSigningImport("windows-pfx", FULL["windows-pfx"])).toEqual({
            kind: "windows-pfx",
            label: "Release",
            file: "C:/keys/release.pfx",
            password: "pfx-secret",
        });
        expect(buildSigningImport("ios-apple", FULL["ios-apple"])).toEqual({
            kind: "ios-apple",
            label: "Apple",
            p12File: "C:/keys/apple.p12",
            provisioningProfileFile: "C:/keys/app.mobileprovision",
            p12Password: "p12-secret",
        });
        expect(buildSigningImport("macos-keychain", FULL["macos-keychain"])).toEqual({
            kind: "macos-keychain",
            label: "Mac",
            identity: "Developer ID Application: NarraLeaf (A1B2C3D4E5)",
            notaryKeyFile: "/keys/AuthKey_ABC123.p8",
            notaryKeyId: "ABC123",
            notaryIssuerId: "11111111-2222-3333-4444-555555555555",
        });
        // The notary keys are omitted entirely rather than sent as empty
        // strings: the vault treats "" as absent, but a payload that carries
        // three blank fields is one refactor away from carrying three blank
        // material paths it then tries to copy.
        expect(buildSigningImport("macos-apple", { ...FULL["macos-apple"], ...NO_NOTARIZATION })).toEqual({
            kind: "macos-apple",
            label: "Mac file",
            p12File: "/keys/developer-id.p12",
            p12Password: "p12-secret",
        });
        expect(buildSigningImport("windows-azure", FULL["windows-azure"])).toEqual({
            kind: "windows-azure",
            label: "Cloud",
            endpoint: "https://eus.codesigning.azure.net",
            codeSigningAccountName: "narraleaf",
            certificateProfileName: "public",
            publisherName: "CN=NarraLeaf",
        });
    });

    it("reads an empty key password as 'the same as the keystore password'", () => {
        // keytool's own default, and the shape of nearly every keystore an
        // author brings. The vault requires a non-empty value either way.
        expect(buildSigningImport("android-keystore", { ...FULL["android-keystore"], keyPassword: "" }))
            .toMatchObject({ storePassword: "store-secret", keyPassword: "store-secret" });
    });

    it("leaves passwords exactly as typed", () => {
        // Trimming a password silently changes it, and the author would have no
        // way to tell why signing fails.
        expect(buildSigningImport("windows-pfx", { ...FULL["windows-pfx"], password: "  pad  " }))
            .toMatchObject({ password: "  pad  " });
    });

    it("omits optional fields left blank rather than storing empty strings", () => {
        expect(buildSigningImport("linux-gpg", { label: "GPG", keyId: "0xDEADBEEF" }))
            .toEqual({ kind: "linux-gpg", label: "GPG", keyId: "0xDEADBEEF" });
        expect(buildSigningImport("windows-store", { label: "Token", sha1: "AABB" }))
            .toEqual({ kind: "windows-store", label: "Token", sha1: "AABB" });
    });

    it("carries nothing over from a kind the author switched away from", () => {
        // The form keeps one draft object; a payload built by spreading it would
        // ship a stale PFX password to the vault as an unknown extra field.
        const contaminated: SigningImportDraft = { ...FULL["linux-gpg"], ...FULL["windows-pfx"], label: "GPG" };

        expect(buildSigningImport("linux-gpg", contaminated))
            .toEqual({ kind: "linux-gpg", label: "GPG", keyId: "0xDEADBEEF", gpgPath: "C:/gpg/gpg.exe" });
    });
});
