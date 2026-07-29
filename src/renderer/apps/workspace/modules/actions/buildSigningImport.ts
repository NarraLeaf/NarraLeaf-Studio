import type { TranslationKey } from "@shared/i18n";
import {
    SIGNING_CREDENTIAL_MATERIAL_FIELDS,
    SIGNING_CREDENTIAL_SECRET_FIELDS,
    type SigningCredentialImport,
    type SigningCredentialKind,
} from "@shared/types/signing";

/**
 * What the Signing section's import form asks for, per credential kind, and how
 * the answers become a `SigningCredentialImport`.
 *
 * Kept out of the component so "which fields does this kind need?" is a pure
 * question with a test, rather than something only a rendered form can answer.
 * The shape is checked against the shared field tables at the bottom of this
 * file's test: a kind that grows a material or secret field and does not grow a
 * form row would otherwise ship an import that silently drops it.
 */

/** A field the author fills in. `name` is the key in the import payload. */
export type SigningImportField =
    | { type: "text" | "secret"; name: string; labelKey: TranslationKey; optional?: boolean; placeholderKey?: TranslationKey }
    | { type: "file"; name: string; labelKey: TranslationKey; extensions: string[] }
    /** A key inside a keystore, listed by opening `fileField` with `passwordField`. */
    | { type: "alias"; name: string; labelKey: TranslationKey; fileField: string; passwordField: string };

/** The form's answers so far. `label` is always present; the rest is per kind. */
export type SigningImportDraft = { label: string } & Record<string, string | undefined>;

/**
 * Keystore extensions the picker offers. It is a convenience only - the picker
 * keeps its "All Files" entry and nothing here rejects a file on its name.
 * Android Studio writes PKCS#12 into files called `.jks`, and keytool will
 * write either format under either name, so the container is decided by its
 * bytes when it is opened.
 */
const KEYSTORE_EXTENSIONS = ["jks", "keystore", "p12", "pfx"];

const IMPORT_FIELDS: Record<SigningCredentialKind, SigningImportField[]> = {
    "windows-pfx": [
        { type: "file", name: "file", labelKey: "build.signing.field.pfx", extensions: ["pfx", "p12"] },
        { type: "secret", name: "password", labelKey: "build.signing.field.password" },
    ],
    "windows-store": [
        { type: "text", name: "subjectName", labelKey: "build.signing.field.subjectName", optional: true },
        { type: "text", name: "sha1", labelKey: "build.signing.field.sha1", optional: true },
    ],
    "windows-azure": [
        { type: "text", name: "endpoint", labelKey: "build.signing.field.endpoint" },
        { type: "text", name: "codeSigningAccountName", labelKey: "build.signing.field.account" },
        { type: "text", name: "certificateProfileName", labelKey: "build.signing.field.profile" },
        { type: "text", name: "publisherName", labelKey: "build.signing.field.publisher" },
    ],
    "android-keystore": [
        { type: "file", name: "file", labelKey: "build.signing.field.keystore", extensions: KEYSTORE_EXTENSIONS },
        { type: "secret", name: "storePassword", labelKey: "build.signing.field.storePassword" },
        {
            type: "secret",
            name: "keyPassword",
            labelKey: "build.signing.field.keyPassword",
            // Usually the same as the store password, and keytool defaults it
            // that way, so an empty box means "same" rather than "no password".
            optional: true,
            placeholderKey: "build.signing.keyPasswordSame",
        },
        {
            type: "alias",
            name: "alias",
            labelKey: "build.signing.field.alias",
            fileField: "file",
            passwordField: "storePassword",
        },
    ],
    "ios-apple": [
        { type: "file", name: "p12File", labelKey: "build.signing.field.appleCertificate", extensions: ["p12", "pfx"] },
        { type: "secret", name: "p12Password", labelKey: "build.signing.field.password" },
        {
            type: "file",
            name: "provisioningProfileFile",
            labelKey: "build.signing.field.provisioningProfile",
            extensions: ["mobileprovision"],
        },
    ],
    "linux-gpg": [
        { type: "text", name: "keyId", labelKey: "build.signing.field.keyId" },
        { type: "text", name: "gpgPath", labelKey: "build.signing.field.gpgPath", optional: true },
    ],
};

export function importFieldsFor(kind: SigningCredentialKind): SigningImportField[] {
    return IMPORT_FIELDS[kind];
}

/**
 * Whether the form has enough to import. Deliberately the same rule the vault
 * enforces, so the button goes live exactly when the import would succeed - a
 * `windows-store` credential needs one of its two fields, everything else needs
 * all of the ones not marked optional.
 */
export function isImportComplete(kind: SigningCredentialKind, draft: SigningImportDraft): boolean {
    if (!draft.label.trim()) {
        return false;
    }
    if (kind === "windows-store") {
        return Boolean(draft.subjectName?.trim() || draft.sha1?.trim());
    }
    return IMPORT_FIELDS[kind].every(field => field.type === "alias"
        ? Boolean(draft[field.name]?.trim())
        : ("optional" in field && field.optional) || Boolean(draft[field.name]?.trim()));
}

/**
 * Turn the form's answers into the payload the vault takes. Built per kind
 * rather than by spreading the draft: the payload carries plain passwords, and
 * an untyped spread would happily send along whatever a previous kind left in
 * the draft.
 */
export function buildSigningImport(kind: SigningCredentialKind, draft: SigningImportDraft): SigningCredentialImport {
    const label = draft.label.trim();
    const read = (name: string): string => draft[name]?.trim() ?? "";
    switch (kind) {
        case "windows-pfx":
            // Not trimmed: a password's whitespace is part of it.
            return { kind, label, file: read("file"), password: draft.password ?? "" };
        case "windows-store":
            return {
                kind,
                label,
                ...(read("subjectName") ? { subjectName: read("subjectName") } : {}),
                ...(read("sha1") ? { sha1: read("sha1") } : {}),
            };
        case "windows-azure":
            return {
                kind,
                label,
                endpoint: read("endpoint"),
                codeSigningAccountName: read("codeSigningAccountName"),
                certificateProfileName: read("certificateProfileName"),
                publisherName: read("publisherName"),
            };
        case "android-keystore":
            return {
                kind,
                label,
                file: read("file"),
                alias: read("alias"),
                storePassword: draft.storePassword ?? "",
                // An empty key password means "the same one", which is what
                // keytool produces unless the author asked for otherwise.
                keyPassword: draft.keyPassword || (draft.storePassword ?? ""),
            };
        case "ios-apple":
            return {
                kind,
                label,
                p12File: read("p12File"),
                provisioningProfileFile: read("provisioningProfileFile"),
                p12Password: draft.p12Password ?? "",
            };
        case "linux-gpg":
            return {
                kind,
                label,
                keyId: read("keyId"),
                ...(read("gpgPath") ? { gpgPath: read("gpgPath") } : {}),
            };
    }
}

/** Every field name the form collects for a kind. Used by the test below. */
export function importFieldNames(kind: SigningCredentialKind): string[] {
    return IMPORT_FIELDS[kind].map(field => field.name);
}

/** The material and secret fields the vault expects, for the same comparison. */
export function requiredVaultFields(kind: SigningCredentialKind): string[] {
    return [...SIGNING_CREDENTIAL_MATERIAL_FIELDS[kind], ...SIGNING_CREDENTIAL_SECRET_FIELDS[kind]];
}
