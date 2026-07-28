/**
 * Machine-level code-signing credentials.
 *
 * A project stores only a credential *id*; the key material and the passwords
 * live in the machine's vault under `<userData>/signing/` and never enter a
 * project directory (projects are version controlled - see managers/vcs/).
 * Opening the same project on another machine leaves the id dangling, which is
 * the intended behaviour: the author imports the same credential there.
 *
 * Nothing in this file is a secret. `SigningCredential` is the redacted shape
 * that crosses IPC and reaches the renderer; the sealed passwords stay in the
 * vault file and are only ever unsealed in the main process, by
 * `SigningVault.resolveMaterial`.
 */

/** Which build target a credential kind can sign. */
export type SigningPlatform = "windows" | "linux" | "android" | "ios";

export type SigningCredentialKind =
    | "windows-pfx"
    | "windows-store"
    | "windows-azure"
    | "android-keystore"
    | "ios-apple"
    | "linux-gpg";

type SigningCredentialBase = {
    /**
     * Opaque, generated at import. Stable for the lifetime of the credential
     * and the only thing a project ever stores. Not for display - use `label`.
     */
    id: string;
    /** What the author called it. The only identifier shown in the UI. */
    label: string;
    /** ISO 8601, when the credential was imported on this machine. */
    createdAt: string;
    /**
     * The password could not be sealed because the OS keyring was unavailable
     * (`safeStorage.isEncryptionAvailable()` was false), so it was not written
     * to disk at all. Preflight reports this; only ever set on kinds that carry
     * a secret.
     */
    secretUnavailable?: boolean;
};

/** A PFX / PKCS#12 file plus its password. */
export type WindowsPfxCredential = SigningCredentialBase & {
    kind: "windows-pfx";
    /**
     * Name of the copy inside this credential's material directory, not the
     * path the author picked. Resolve it with `SigningVault.resolveMaterial`.
     */
    file: string;
};

/**
 * A certificate already in the Windows certificate store - typically backed by
 * a hardware token or HSM, so there is no file and no password to hold.
 */
export type WindowsStoreCredential = SigningCredentialBase & {
    kind: "windows-store";
    subjectName?: string;
    sha1?: string;
};

/**
 * Azure Trusted Signing. The Entra credentials come from the host environment
 * (the TrustedSigning tooling reads them itself); Studio deliberately does not
 * hold them.
 */
export type WindowsAzureCredential = SigningCredentialBase & {
    kind: "windows-azure";
    endpoint: string;
    codeSigningAccountName: string;
    certificateProfileName: string;
    publisherName: string;
};

/** An Android release keystore (.p12 / .jks / .keystore) and the alias to sign with. */
export type AndroidKeystoreCredential = SigningCredentialBase & {
    kind: "android-keystore";
    /** Name of the copy inside this credential's material directory. */
    file: string;
    alias: string;
};

/** An Apple signing identity: a .p12 plus the provisioning profile to embed. */
export type IosAppleCredential = SigningCredentialBase & {
    kind: "ios-apple";
    /** Name of the copy inside this credential's material directory. */
    p12File: string;
    /** Name of the copy inside this credential's material directory. */
    provisioningProfileFile: string;
};

/**
 * A GPG key for detached signatures over the build artifacts. The private key
 * stays in the host's gpg-agent - Studio never holds it, so there is no secret
 * here either.
 */
export type LinuxGpgCredential = SigningCredentialBase & {
    kind: "linux-gpg";
    keyId: string;
    gpgPath?: string;
};

/** The redacted credential. This is what `list`, `get` and IPC return. */
export type SigningCredential =
    | WindowsPfxCredential
    | WindowsStoreCredential
    | WindowsAzureCredential
    | AndroidKeystoreCredential
    | IosAppleCredential
    | LinuxGpgCredential;

/** The platform each kind can sign, so the UI can offer only the relevant ones. */
export const SIGNING_CREDENTIAL_PLATFORM: Record<SigningCredentialKind, SigningPlatform> = {
    "windows-pfx": "windows",
    "windows-store": "windows",
    "windows-azure": "windows",
    "android-keystore": "android",
    "ios-apple": "ios",
    "linux-gpg": "linux",
};

export const SIGNING_CREDENTIAL_KINDS: readonly SigningCredentialKind[] =
    Object.keys(SIGNING_CREDENTIAL_PLATFORM) as SigningCredentialKind[];

export function signingKindsForPlatform(platform: SigningPlatform): SigningCredentialKind[] {
    return SIGNING_CREDENTIAL_KINDS.filter(kind => SIGNING_CREDENTIAL_PLATFORM[kind] === platform);
}

export function isSigningCredentialKind(value: unknown): value is SigningCredentialKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(SIGNING_CREDENTIAL_PLATFORM, value);
}

/**
 * Fields whose value is a file the vault copies in at import. Single source of
 * truth for the vault, the import UI and anything that has to walk a
 * credential's material.
 */
export const SIGNING_CREDENTIAL_MATERIAL_FIELDS: Record<SigningCredentialKind, readonly string[]> = {
    "windows-pfx": ["file"],
    "windows-store": [],
    "windows-azure": [],
    "android-keystore": ["file"],
    "ios-apple": ["p12File", "provisioningProfileFile"],
    "linux-gpg": [],
};

/** Fields that are secret: sealed on import, never serialized in a credential. */
export const SIGNING_CREDENTIAL_SECRET_FIELDS: Record<SigningCredentialKind, readonly string[]> = {
    "windows-pfx": ["password"],
    "windows-store": [],
    "windows-azure": [],
    "android-keystore": ["storePassword", "keyPassword"],
    "ios-apple": ["p12Password"],
    "linux-gpg": [],
};

/**
 * What the author supplies when importing. File fields hold the absolute path
 * the author picked; the vault copies each one in and rewrites the field to the
 * name of its copy. Secret fields hold plain text and are sealed immediately -
 * an import payload must never be logged or persisted as-is.
 */
export type SigningCredentialImport =
    | { kind: "windows-pfx"; label: string; file: string; password: string }
    | { kind: "windows-store"; label: string; subjectName?: string; sha1?: string }
    | {
        kind: "windows-azure";
        label: string;
        endpoint: string;
        codeSigningAccountName: string;
        certificateProfileName: string;
        publisherName: string;
    }
    | {
        kind: "android-keystore";
        label: string;
        file: string;
        alias: string;
        storePassword: string;
        keyPassword: string;
    }
    | { kind: "ios-apple"; label: string; p12File: string; provisioningProfileFile: string; p12Password: string }
    | { kind: "linux-gpg"; label: string; keyId: string; gpgPath?: string };

/**
 * A credential unsealed for one build: absolute material paths and the plain
 * passwords. **Main process only** - it must never cross IPC, be logged, or be
 * written anywhere. A `null` password means the secret was never persisted
 * (see `secretUnavailable`), not that the password is empty.
 */
export type ResolvedSigningMaterial =
    | { kind: "windows-pfx"; id: string; file: string; password: string | null }
    | { kind: "windows-store"; id: string; subjectName?: string; sha1?: string }
    | {
        kind: "windows-azure";
        id: string;
        endpoint: string;
        codeSigningAccountName: string;
        certificateProfileName: string;
        publisherName: string;
    }
    | {
        kind: "android-keystore";
        id: string;
        file: string;
        alias: string;
        storePassword: string | null;
        keyPassword: string | null;
    }
    | { kind: "ios-apple"; id: string; p12File: string; provisioningProfileFile: string; p12Password: string | null }
    | { kind: "linux-gpg"; id: string; keyId: string; gpgPath?: string };

/** Display-only facts about a credential's certificate. Carries no key material. */
export type SigningCertificateInfo = {
    /** RFC 4514-ish subject line, as Node's X.509 parser renders it. */
    subject: string;
    issuer: string;
    /** ISO 8601. */
    notBefore: string;
    /** ISO 8601. */
    notAfter: string;
    /** SHA-1 thumbprint, uppercase hex, no separators. */
    sha1: string;
    /** Uppercase hex, as printed by certificate tooling. */
    serialNumber: string;
};

/**
 * Why no certificate could be read.
 * - `no-certificate`: the kind has no certificate file to read (the certificate
 *   lives in the Windows store, in Azure, or there is none at all).
 * - `unsupported-format`: a container that cannot be opened here - a keystore
 *   asked about without the password that opens it, or one written in a format
 *   the reader refuses (JCEKS, an algorithm it does not implement).
 * - `unreadable`: the file is missing, is not a certificate, or did not open -
 *   a wrong password, an alias that is not in there, a damaged file.
 */
export type SigningInspectUnavailableReason = "no-certificate" | "unsupported-format" | "unreadable";

export type SigningInspectResult =
    | { available: true; certificate: SigningCertificateInfo }
    | { available: false; reason: SigningInspectUnavailableReason };

/** Where a certificate sits relative to now; drives the preflight expiry codes. */
export type SigningCertificateExpiry = "valid" | "expiring" | "expired" | "not-yet-valid";

/** Days before `notAfter` at which the build dialog starts warning. */
export const SIGNING_EXPIRY_WARNING_DAYS = 30;
