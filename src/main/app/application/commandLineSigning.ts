import path from "path";
import {
    SIGNING_CREDENTIAL_MATERIAL_FIELDS,
    SIGNING_CREDENTIAL_METADATA_FIELDS,
    SIGNING_CREDENTIAL_PLATFORM,
    SIGNING_CREDENTIAL_SECRET_FIELDS,
    SIGNING_OPTIONAL_FIELDS,
    assertNotarizationComplete,
    isSigningCredentialKind,
    signingKindsForPlatform,
    type ResolvedSigningMaterial,
    type SigningCredentialKind,
    type SigningPlatform,
} from "@shared/types/signing";

/**
 * `--build-signing <file>`: the credentials one command-line build signs with.
 *
 * ## Why there is a path at all
 *
 * Signing credentials live in the machine's vault, which is imported through the Build dialog and
 * keyed to the profile. That is right for a person and impossible for a job: a fresh build agent
 * has nobody to click through an import, and a build that runs in its own profile
 * (`--build-user-data-dir`) does not have the vault the machine's owner filled in. Without this,
 * every build a script started was unsigned or refused.
 *
 * ## What it is not
 *
 * It is not a second vault. Nothing here is written anywhere: the file is read, the material is
 * held for the length of one build, and the process exits. Nothing is imported, so a machine that
 * built once is no closer to being able to sign than it was before - which is the point, because a
 * credential a job carried in should leave with it.
 *
 * ## Secrets
 *
 * Every secret field may be given inline or, better, as `<field>Env` naming an environment variable
 * to read it from. Both spellings exist because both jobs exist: a file assembled by a secret
 * manager already holds the value, and a file checked into a pipeline's own configuration must not.
 * Giving both is refused rather than resolved by precedence - a rule nobody would remember is worse
 * than an error nobody has to.
 *
 * A file that holds secrets inline is a file with the same weight as the key beside it. Studio does
 * not (and cannot) enforce its permissions; what it does do is never log it, never copy it, and
 * never write any part of it into the build report.
 *
 * ## Shape
 *
 * One entry per signing platform, each naming a credential kind and that kind's own fields - the
 * same fields the vault stores, which is what keeps this from becoming a second description of what
 * a credential is:
 *
 * ```json
 * {
 *   "windows": { "kind": "windows-pfx", "file": "certs/app.pfx", "passwordEnv": "PFX_PASSWORD" },
 *   "macos": {
 *     "kind": "macos-apple",
 *     "p12File": "certs/developer-id.p12",
 *     "p12PasswordEnv": "P12_PASSWORD",
 *     "notaryKeyFile": "certs/notary.p8",
 *     "notaryKeyId": "ABCD1234",
 *     "notaryIssuerId": "6a0e...-..."
 *   },
 *   "linux": { "kind": "linux-gpg", "keyId": "8A1C..." }
 * }
 * ```
 *
 * File fields are resolved against the file's own directory, so a credentials bundle can be copied
 * onto an agent whole and still work wherever it lands.
 */

/** One credential a command line handed over, ready for the build to use. */
export type CommandLineSigningCredential = {
    platform: SigningPlatform;
    kind: SigningCredentialKind;
    /**
     * What the build console calls it. A credential from the command line has no label of the
     * author's, and its kind is the only honest thing to name it by.
     */
    label: string;
    /**
     * Unsealed material, in exactly the shape `SigningVault.resolveMaterial` produces. **Main
     * process only** - it must not cross IPC, be logged, or be written anywhere.
     */
    material: ResolvedSigningMaterial;
};

export type CommandLineSigningResult =
    | { ok: true; credentials: CommandLineSigningCredential[] }
    | { ok: false; reason: string };

/** Every platform that can hold a credential, in a fixed order so two runs report the same first fault. */
const PLATFORMS: readonly SigningPlatform[] = ["windows", "macos", "linux", "android", "ios"];

/**
 * Turn a parsed `--build-signing` document into the credentials a build can sign with, or say what
 * is wrong with it.
 *
 * The file system is reached through `exists` alone, and the environment is passed in: everything
 * else here is a decision about the document, which is what makes the refusals readable in a test.
 */
export async function readCommandLineSigning(input: {
    /** The parsed JSON document. */
    document: unknown;
    /** The file's own directory. Relative material paths resolve against it. */
    directory: string;
    env: Record<string, string | undefined>;
    exists: (candidate: string) => Promise<boolean>;
}): Promise<CommandLineSigningResult> {
    const { document, directory, env, exists } = input;
    if (!document || typeof document !== "object" || Array.isArray(document)) {
        return { ok: false, reason: "The signing file must hold an object keyed by platform." };
    }
    const entries = document as Record<string, unknown>;

    const unknown = Object.keys(entries).filter(key => !(PLATFORMS as string[]).includes(key));
    if (unknown.length > 0) {
        // Refused rather than ignored, for the reason every other misspelling on this command line
        // is: a job that wrote "mac" believes it is shipping a signed build.
        return {
            ok: false,
            reason: `The signing file names "${unknown[0]}", which is not a platform.`
                + ` Expected one of: ${PLATFORMS.join(", ")}.`,
        };
    }

    const credentials: CommandLineSigningCredential[] = [];
    for (const platform of PLATFORMS) {
        const entry = entries[platform];
        if (entry === undefined || entry === null) {
            continue;
        }
        const read = await readCredential({ platform, entry, directory, env, exists });
        if (!read.ok) {
            return read;
        }
        credentials.push(read.credential);
    }
    if (credentials.length === 0) {
        return { ok: false, reason: "The signing file names no credentials." };
    }
    return { ok: true, credentials };
}

type CredentialResult =
    | { ok: true; credential: CommandLineSigningCredential }
    | { ok: false; reason: string };

async function readCredential(input: {
    platform: SigningPlatform;
    entry: unknown;
    directory: string;
    env: Record<string, string | undefined>;
    exists: (candidate: string) => Promise<boolean>;
}): Promise<CredentialResult> {
    const { platform, entry, directory, env, exists } = input;
    const where = `The signing file's "${platform}" entry`;
    if (typeof entry !== "object" || Array.isArray(entry)) {
        return { ok: false, reason: `${where} must be an object.` };
    }
    const fields = entry as Record<string, unknown>;

    const kind = fields.kind;
    if (typeof kind !== "string" || !isSigningCredentialKind(kind)) {
        return {
            ok: false,
            reason: `${where} needs a "kind". The kinds that sign ${platform} are:`
                + ` ${signingKindsForPlatform(platform).join(", ")}.`,
        };
    }
    if (SIGNING_CREDENTIAL_PLATFORM[kind] !== platform) {
        return {
            ok: false,
            reason: `${where} is a "${kind}" credential, which signs`
                + ` ${SIGNING_CREDENTIAL_PLATFORM[kind]} rather than ${platform}.`,
        };
    }

    // The synthetic id stands in for the vault handle a credential normally carries. Nothing reads
    // it - the worker signs from the material - but it keeps the resolved shape whole, and it says
    // where the credential came from anywhere it is printed.
    const material: Record<string, unknown> = { id: `command-line:${platform}`, kind };

    for (const field of SIGNING_CREDENTIAL_METADATA_FIELDS[kind]) {
        const value = fields[field];
        if (isBlank(value)) {
            if (SIGNING_OPTIONAL_FIELDS.has(field)) {
                continue;
            }
            return { ok: false, reason: `${where} needs "${field}".` };
        }
        if (typeof value !== "string") {
            return { ok: false, reason: `${where} has a "${field}" that is not text.` };
        }
        material[field] = value.trim();
    }
    if (kind === "windows-store" && !material.subjectName && !material.sha1) {
        return { ok: false, reason: `${where} needs a subject name or a thumbprint.` };
    }

    for (const field of SIGNING_CREDENTIAL_MATERIAL_FIELDS[kind]) {
        const value = fields[field];
        if (isBlank(value)) {
            if (SIGNING_OPTIONAL_FIELDS.has(field)) {
                continue;
            }
            return { ok: false, reason: `${where} needs "${field}".` };
        }
        if (typeof value !== "string") {
            return { ok: false, reason: `${where} has a "${field}" that is not a path.` };
        }
        // Against the file's directory rather than the working directory: the file and the key
        // material travel together, and a job that copies both onto an agent should not have to
        // know where the shell was standing.
        const resolved = path.resolve(directory, value.trim());
        if (!await exists(resolved)) {
            return { ok: false, reason: `${where} points "${field}" at a file that is not there: ${resolved}` };
        }
        material[field] = resolved;
    }

    try {
        assertNotarizationComplete(kind, material);
    } catch (error) {
        return { ok: false, reason: `${where}: ${error instanceof Error ? error.message : String(error)}` };
    }

    for (const field of SIGNING_CREDENTIAL_SECRET_FIELDS[kind]) {
        const secret = readSecret(fields, field, env);
        if (!secret.ok) {
            return { ok: false, reason: `${where} ${secret.reason}` };
        }
        material[field] = secret.value;
    }

    return {
        ok: true,
        credential: {
            platform,
            kind,
            label: `${kind} (--build-signing)`,
            // Assembled field by field from the same whitelists the vault uses, so it matches the
            // union by construction; TS cannot follow that.
            material: material as ResolvedSigningMaterial,
        },
    };
}

/**
 * One secret field, from the document or from the environment.
 *
 * An empty inline value is a value: a PFX with no password is a real thing, and treating "" as
 * "not given" would send the caller looking for a variable they deliberately did not set. An empty
 * *environment* variable is not, because that is what an unset one looks like to a shell that
 * expanded it, and a build signed with an accidentally blank password fails at the far end.
 */
function readSecret(
    fields: Record<string, unknown>,
    field: string,
    env: Record<string, string | undefined>,
): { ok: true; value: string } | { ok: false; reason: string } {
    const inline = fields[field];
    const variable = fields[`${field}Env`];
    if (inline !== undefined && variable !== undefined) {
        return { ok: false, reason: `gives both "${field}" and "${field}Env". Give one.` };
    }
    if (typeof variable === "string" && variable.trim()) {
        const value = env[variable.trim()];
        if (!value) {
            return { ok: false, reason: `reads "${field}" from ${variable.trim()}, which is not set.` };
        }
        return { ok: true, value };
    }
    if (variable !== undefined) {
        return { ok: false, reason: `has a "${field}Env" that is not the name of a variable.` };
    }
    if (typeof inline === "string") {
        return { ok: true, value: inline };
    }
    return { ok: false, reason: `needs "${field}", or "${field}Env" naming a variable to read it from.` };
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
