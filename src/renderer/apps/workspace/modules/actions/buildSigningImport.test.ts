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
    "ios-apple": {
        label: "Apple",
        p12File: "C:/keys/apple.p12",
        p12Password: "p12-secret",
        provisioningProfileFile: "C:/keys/app.mobileprovision",
    },
    "linux-gpg": { label: "GPG", keyId: "0xDEADBEEF", gpgPath: "C:/gpg/gpg.exe" },
};

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
