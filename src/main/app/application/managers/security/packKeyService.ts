import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { derivePackEncryptionKey } from "@narraleaf/encryption";

/**
 * Resolves the opaque per-project key used when asset protection is enabled.
 * The key material is produced by @narraleaf/encryption from locally persisted
 * secrets; this module only reads (or creates on first use) those secrets and
 * hands them off. The secrets never leave the machine and the key itself is
 * never stored.
 */

const MACHINE_SECRET_LENGTH = 32;
const PROJECT_SALT_LENGTH = 16;

const MACHINE_SECRET_RELATIVE = path.join("security", "machine.key");
const PROJECT_SALT_RELATIVE = path.join("editor", ".security", "packkey.salt");

/** Read (or create on first use) the per-machine secret from the user-data dir. */
export async function getMachineSecret(userDataDir: string): Promise<Buffer> {
    return readOrCreateSecret(path.join(userDataDir, MACHINE_SECRET_RELATIVE), MACHINE_SECRET_LENGTH);
}

/** Read (or create on first use) the per-project salt, stored inside the project. */
export async function getProjectSalt(projectPath: string): Promise<Buffer> {
    return readOrCreateSecret(path.join(projectPath, PROJECT_SALT_RELATIVE), PROJECT_SALT_LENGTH);
}

/**
 * Resolve the pack key for this project on this machine. Deterministic across
 * builds for a given (machine, project) pair. The returned string is opaque and
 * is consumed by the packaging pipeline; the key material never appears here.
 */
export async function resolvePackEncryptionKey(userDataDir: string, projectPath: string): Promise<string> {
    const [machineSecret, projectSalt] = await Promise.all([
        getMachineSecret(userDataDir),
        getProjectSalt(projectPath),
    ]);
    return derivePackEncryptionKey(machineSecret, projectSalt);
}

async function readOrCreateSecret(filePath: string, length: number): Promise<Buffer> {
    try {
        const existing = await fs.readFile(filePath);
        if (existing.length === length) {
            return existing;
        }
        // A truncated/corrupt secret would silently change the key on every read;
        // regenerate it rather than trust a bad file.
    } catch (error) {
        if (!isEnoent(error)) {
            throw error;
        }
    }
    const secret = crypto.randomBytes(length);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, secret, { mode: 0o600 });
    return secret;
}

function isEnoent(error: unknown): boolean {
    return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "ENOENT";
}
