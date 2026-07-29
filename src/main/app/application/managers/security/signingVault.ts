import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
    SIGNING_CREDENTIAL_MATERIAL_FIELDS,
    SIGNING_CREDENTIAL_SECRET_FIELDS,
    isSigningCredentialKind,
    type ResolvedSigningMaterial,
    type SigningCredential,
    type SigningCredentialImport,
    type SigningCredentialKind,
} from "@shared/types/signing";

/**
 * The machine's code-signing credential vault, under `<userData>/signing/`:
 *
 *     signing/
 *     ├─ credentials.json        metadata + sealed passwords, 0600
 *     └─ material/<id>/          the imported key material, copied in, 0600
 *
 * Two rules shape everything here.
 *
 * Key material is **copied in**, never referenced where the author picked it.
 * Projects are version controlled now, so a path into a project directory would
 * put a private key under source control the moment a build referenced it - and
 * a build that breaks because the author tidied their Downloads folder is its
 * own kind of bad.
 *
 * Passwords are sealed with the OS keyring (Electron's `safeStorage`, DPAPI on
 * Windows) and are unsealed in exactly one place: `resolveMaterial`. Every other
 * read path - `list`, `get` - returns the redacted `SigningCredential`, which is
 * what crosses IPC. When the keyring is unavailable the password is *not*
 * written in the clear; the credential is flagged `secretUnavailable` and
 * preflight tells the author, which is a worse experience than storing it and a
 * far better one than a plaintext password on disk.
 *
 * The keyring is injected rather than imported so this module stays free of
 * Electron and can be unit tested. Imports are relative-free on purpose:
 * `@shared` resolves under both tsc and vitest, `@/` does not.
 */

/** The subset of Electron's `safeStorage` the vault needs. Injected for testability. */
export type SecretSealer = {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
};

export type SigningVaultOptions = {
    /** The vault root, i.e. `<userData>/signing`. */
    root: string;
    sealer: SecretSealer;
    /** Injected in tests; defaults to a random UUID. */
    generateId?: () => string;
    /** Injected in tests; defaults to the wall clock. */
    now?: () => Date;
};

const CREDENTIALS_FILE = "credentials.json";
const MATERIAL_DIR = "material";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const FORMAT_VERSION = 1;
const MAX_MATERIAL_NAME_LENGTH = 100;

/** Plain, non-secret, non-file fields each kind carries. Whitelisted: import payloads arrive over IPC. */
const METADATA_FIELDS: Record<SigningCredentialKind, readonly string[]> = {
    "windows-pfx": [],
    "windows-store": ["subjectName", "sha1"],
    "windows-azure": ["endpoint", "codeSigningAccountName", "certificateProfileName", "publisherName"],
    "android-keystore": ["alias"],
    "ios-apple": [],
    "linux-gpg": ["keyId", "gpgPath"],
};

const OPTIONAL_FIELDS = new Set(["subjectName", "sha1", "gpgPath"]);

/** A credential as it sits on disk: the redacted shape plus the sealed secrets. */
type StoredCredential = SigningCredential & {
    /** safeStorage ciphertext, base64, keyed by secret field name. Absent when there is nothing to seal. */
    secrets?: Record<string, string>;
};

type CredentialsFile = {
    version: number;
    credentials: StoredCredential[];
};

export class SigningVault {
    private readonly root: string;
    private readonly sealer: SecretSealer;
    private readonly generateId: () => string;
    private readonly now: () => Date;
    /**
     * Serializes the read-modify-write of the index. One main process owns the
     * vault, but several windows can drive it, and an interleaved import would
     * drop somebody's credential.
     */
    private queue: Promise<unknown> = Promise.resolve();

    constructor(options: SigningVaultOptions) {
        this.root = options.root;
        this.sealer = options.sealer;
        this.generateId = options.generateId ?? (() => crypto.randomUUID());
        this.now = options.now ?? (() => new Date());
    }

    /** Every credential on this machine, redacted. Never contains a secret. */
    public async list(): Promise<SigningCredential[]> {
        const file = await this.readIndex();
        return file.credentials.map(redact);
    }

    /** One credential, redacted, or null when the id is dangling. */
    public async get(id: string): Promise<SigningCredential | null> {
        const stored = await this.find(id);
        return stored ? redact(stored) : null;
    }

    /**
     * Copy the key material in, seal the passwords, and record the credential.
     * Returns the redacted credential - the caller never gets its secrets back.
     */
    public async import(input: SigningCredentialImport): Promise<SigningCredential> {
        return this.serialize(async () => {
            const { kind, label } = readKindAndLabel(input);
            const id = this.generateId();
            const materialDir = this.materialDir(id);
            const payload = input as unknown as Record<string, unknown>;

            await fs.mkdir(materialDir, { recursive: true, mode: DIR_MODE });
            try {
                const material: Record<string, string> = {};
                for (const field of SIGNING_CREDENTIAL_MATERIAL_FIELDS[kind]) {
                    const source = requireString(payload[field], field);
                    const name = materialFileName(field, source);
                    const destination = path.join(materialDir, name);
                    await fs.copyFile(source, destination);
                    await fs.chmod(destination, FILE_MODE).catch(() => undefined);
                    material[field] = name;
                }

                const secretFields = SIGNING_CREDENTIAL_SECRET_FIELDS[kind];
                const available = secretFields.length === 0 || this.encryptionAvailable();
                const secrets: Record<string, string> = {};
                for (const field of secretFields) {
                    const value = requireString(payload[field], field);
                    if (available) {
                        secrets[field] = this.sealer.encryptString(value).toString("base64");
                    }
                }

                const metadata: Record<string, string> = {};
                for (const field of METADATA_FIELDS[kind]) {
                    const value = payload[field];
                    if (value === undefined || value === null || value === "") {
                        if (!OPTIONAL_FIELDS.has(field)) {
                            throw new Error(`Signing credential of kind "${kind}" requires ${field}`);
                        }
                        continue;
                    }
                    metadata[field] = requireString(value, field);
                }
                if (kind === "windows-store" && !metadata.subjectName && !metadata.sha1) {
                    throw new Error("A Windows certificate-store credential needs a subject name or a thumbprint");
                }

                // Assembled field by field from the whitelists above, so the
                // result matches the union by construction; TS cannot follow that.
                const stored = {
                    id,
                    kind,
                    label,
                    createdAt: this.now().toISOString(),
                    ...metadata,
                    ...material,
                    ...(available ? {} : { secretUnavailable: true }),
                    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
                } as StoredCredential;

                const file = await this.readIndex();
                file.credentials.push(stored);
                await this.writeIndex(file);
                return redact(stored);
            } catch (error) {
                // A half-imported credential is worse than none: it leaves key
                // material on disk that nothing references and nothing deletes.
                await fs.rm(materialDir, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
        });
    }

    /** Forget a credential and delete its copied key material. */
    public async remove(id: string): Promise<boolean> {
        return this.serialize(async () => {
            const file = await this.readIndex();
            const next = file.credentials.filter(credential => credential.id !== id);
            if (next.length === file.credentials.length) {
                return false;
            }
            await this.writeIndex({ ...file, credentials: next });
            await fs.rm(this.materialDir(id), { recursive: true, force: true });
            return true;
        });
    }

    /**
     * Unseal a credential for one build: absolute material paths and the plain
     * passwords. **The only function that returns a secret.** Main process only -
     * the result must not cross IPC, be logged, or be written anywhere.
     *
     * A password that cannot be unsealed comes back as `null` rather than
     * throwing: the keyring may have gone away, or the credential may have been
     * imported under a different OS account. Preflight turns that into a
     * readable error; a throw here would surface as an opaque build failure.
     */
    public async resolveMaterial(id: string): Promise<ResolvedSigningMaterial | null> {
        const stored = await this.find(id);
        if (!stored) {
            return null;
        }
        const kind = stored.kind;
        const record = stored as unknown as Record<string, unknown>;
        const resolved: Record<string, unknown> = { id: stored.id, kind };

        for (const field of METADATA_FIELDS[kind]) {
            if (record[field] !== undefined) {
                resolved[field] = record[field];
            }
        }
        for (const field of SIGNING_CREDENTIAL_MATERIAL_FIELDS[kind]) {
            const name = requireString(record[field], field);
            resolved[field] = path.join(this.materialDir(stored.id), safeMaterialName(name));
        }
        for (const field of SIGNING_CREDENTIAL_SECRET_FIELDS[kind]) {
            resolved[field] = this.unseal(stored.secrets?.[field]);
        }
        // Same story as `import`: built from the whitelists, so it matches the union.
        return resolved as ResolvedSigningMaterial;
    }

    /**
     * Whether every secret this credential needs can actually be unsealed right
     * now. Preflight's question, and it exists so preflight does not have to
     * call `resolveMaterial` - and hold real passwords - just to ask it.
     *
     * `secretUnavailable` on the credential only records how the import went.
     * This also catches the keyring having gone away since, or the credential
     * having been imported under a different OS account.
     */
    public async secretsAvailable(id: string): Promise<boolean> {
        const stored = await this.find(id);
        if (!stored) {
            return false;
        }
        return SIGNING_CREDENTIAL_SECRET_FIELDS[stored.kind]
            .every(field => this.unseal(stored.secrets?.[field]) !== null);
    }

    /** Absolute path of a credential's material directory. Useful to the inspector. */
    public materialDir(id: string): string {
        return path.join(this.root, MATERIAL_DIR, safeIdSegment(id));
    }

    /** Absolute path of one of a credential's material files, or null if it has none by that name. */
    public materialPath(credential: SigningCredential, field: string): string | null {
        const record = credential as unknown as Record<string, unknown>;
        const name = record[field];
        if (typeof name !== "string" || !name) {
            return null;
        }
        return path.join(this.materialDir(credential.id), safeMaterialName(name));
    }

    private encryptionAvailable(): boolean {
        try {
            return this.sealer.isEncryptionAvailable();
        } catch {
            return false;
        }
    }

    private unseal(sealed: string | undefined): string | null {
        if (!sealed) {
            return null;
        }
        try {
            if (!this.encryptionAvailable()) {
                return null;
            }
            return this.sealer.decryptString(Buffer.from(sealed, "base64"));
        } catch {
            return null;
        }
    }

    private async find(id: string): Promise<StoredCredential | null> {
        const file = await this.readIndex();
        return file.credentials.find(credential => credential.id === id) ?? null;
    }

    private serialize<T>(run: () => Promise<T>): Promise<T> {
        const next = this.queue.then(run, run);
        // Keep the chain alive after a rejected operation, without swallowing it
        // for the caller.
        this.queue = next.catch(() => undefined);
        return next;
    }

    private indexPath(): string {
        return path.join(this.root, CREDENTIALS_FILE);
    }

    /**
     * Read the index, or start an empty one. A file that will not parse is moved
     * aside rather than overwritten: it is the only record of what was imported,
     * and silently starting empty would orphan the material directories with no
     * way back.
     */
    private async readIndex(): Promise<CredentialsFile> {
        let raw: string;
        try {
            raw = await fs.readFile(this.indexPath(), "utf8");
        } catch (error) {
            if (isEnoent(error)) {
                return { version: FORMAT_VERSION, credentials: [] };
            }
            throw error;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            await this.quarantineIndex();
            return { version: FORMAT_VERSION, credentials: [] };
        }
        const credentials = (parsed as CredentialsFile | null)?.credentials;
        if (!Array.isArray(credentials)) {
            await this.quarantineIndex();
            return { version: FORMAT_VERSION, credentials: [] };
        }
        // One unusable record must not cost the author the rest of them.
        return { version: FORMAT_VERSION, credentials: credentials.filter(isUsableCredential) };
    }

    private async quarantineIndex(): Promise<void> {
        const aside = `${this.indexPath()}.corrupt-${Date.now()}`;
        await fs.rename(this.indexPath(), aside).catch(() => undefined);
    }

    /**
     * Write via a fresh temp file and rename. Beyond atomicity that is what makes
     * `mode` stick: `writeFile` only applies it when it creates the file, so
     * rewriting in place would leave whatever mode the file already had.
     */
    private async writeIndex(file: CredentialsFile): Promise<void> {
        await fs.mkdir(this.root, { recursive: true, mode: DIR_MODE });
        const target = this.indexPath();
        const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(file, null, 2), { mode: FILE_MODE });
        await fs.rename(temporary, target);
    }
}

/** Strip the sealed secrets. Everything that leaves the vault goes through here. */
function redact(stored: StoredCredential): SigningCredential {
    const { secrets: _secrets, ...credential } = stored as StoredCredential & { secrets?: unknown };
    return credential as SigningCredential;
}

function isUsableCredential(value: unknown): value is StoredCredential {
    const credential = value as Partial<StoredCredential> | null;
    return Boolean(
        credential
        && typeof credential.id === "string"
        && credential.id.length > 0
        && typeof credential.label === "string"
        && isSigningCredentialKind(credential.kind),
    );
}

/**
 * Read through an untyped view: the payload arrives over IPC, so the declared
 * type is a claim rather than a fact, and the checks below have to survive TS
 * proving them "impossible".
 */
function readKindAndLabel(input: SigningCredentialImport): { kind: SigningCredentialKind; label: string } {
    const payload = input as unknown as { kind?: unknown; label?: unknown } | null | undefined;
    const kind = payload?.kind;
    if (!isSigningCredentialKind(kind)) {
        throw new Error(`Unknown signing credential kind: ${String(kind)}`);
    }
    const label = typeof payload?.label === "string" ? payload.label.trim() : "";
    if (!label) {
        throw new Error("A signing credential needs a name");
    }
    return { kind, label };
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw new Error(`Signing credential field "${field}" is required`);
    }
    return value;
}

/**
 * Name the copy after the file the author picked, namespaced by the field so two
 * fields of the same credential cannot collide. Sanitized because the source
 * name is author-supplied and this becomes a path.
 */
function materialFileName(field: string, sourcePath: string): string {
    const base = path.basename(sourcePath)
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/^\.+/, "")
        .slice(0, MAX_MATERIAL_NAME_LENGTH);
    return base ? `${field}-${base}` : field;
}

/**
 * Re-checked on the way out, not just on the way in: `credentials.json` is a
 * file on the author's disk, and a hand-edited (or tampered) entry must not turn
 * into a path outside the vault.
 */
function safeMaterialName(name: string): string {
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        throw new Error("Signing credential references material outside its own directory");
    }
    return name;
}

function safeIdSegment(id: string): string {
    if (!id || id.includes("/") || id.includes("\\") || id === "." || id === "..") {
        throw new Error("Invalid signing credential id");
    }
    return id;
}

function isEnoent(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
