import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import type { GameBuildWorkerGpgSigning } from "./protocol";

/**
 * Detached OpenPGP signatures over the finished artifacts.
 *
 * This is distribution integrity, not an OS-enforced code signature: no
 * platform checks it at install time. What it is for is the pair
 * `SHA256SUMS` + `SHA256SUMS.asc`, which lets anyone who has the author's
 * public key prove that the bytes they downloaded are the bytes the author
 * built - the convention every Linux release has followed for decades.
 *
 * The private key never leaves the host's gpg-agent. Studio spawns gpg and
 * reads its exit code; it does not hold, unseal or forward key material, which
 * is why the credential carries only a key id.
 */

const execFileAsync = promisify(execFile);

type Log = (level: "info" | "warning" | "error", message: string) => void;

async function isFile(candidate: string): Promise<boolean> {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        return false;
    }
}

async function firstExistingFile(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
        if (await isFile(candidate)) {
            return candidate;
        }
    }
    return null;
}

export type GpgProbeInput = {
    /** `gpgPath` from the credential, when the author set one. */
    configuredPath?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /**
     * The host's well-known install locations, searched after PATH. Defaults to
     * `MACOS_GPG_DIRS` on macOS and to nothing elsewhere - Windows derives its
     * own from the environment, and on Linux a gpg that is not on PATH is a
     * deliberate choice the credential's `gpgPath` covers.
     *
     * Injected for the same reason `platform` and `env` are: these are absolute
     * paths, so a test can only judge the search against a tree it built itself.
     */
    fallbackDirs?: string[];
};

/**
 * Where macOS keeps a gpg that PATH will not mention.
 *
 * A GUI-launched app on macOS does not inherit the login shell's environment -
 * launchd hands it a PATH of `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else.
 * Every way of installing gpg on a Mac puts it somewhere outside that: Homebrew
 * on Apple Silicon, Homebrew on Intel, MacPorts, and GPG Suite in that order.
 * So the PATH search below finds gpg when Studio was started from a terminal and
 * misses it when the author double-clicked the icon - the same binary, the same
 * machine, two different verdicts. This list is what makes the two agree.
 */
export const MACOS_GPG_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/local/MacGPG2/bin"];

/**
 * Absolute path of a gpg binary, or null when the host has none.
 *
 * Order: the credential's own path, `GNUPG_PATH`, a native Gpg4win install,
 * anything on PATH, and finally a host-specific fallback - the gpg that ships
 * inside Git for Windows, or the install locations macOS hides from a
 * GUI process.
 *
 * Neither fallback is a curiosity. On a Windows dev machine Git's gpg is usually
 * the only one there is, and it is invisible to a PATH search because Git puts it
 * under `usr/bin`, which only Git Bash adds; it has to be derived from wherever
 * git itself was found, since Git for Windows is routinely installed outside
 * Program Files. It is last because it is an MSYS build with POSIX path
 * semantics, which behaves differently from a native one for anything
 * path-shaped (see `signArtifactsWithGpg` on why we never hand it GNUPGHOME).
 * The macOS arm is explained at `MACOS_GPG_DIRS`.
 */
export async function findGpg(input: GpgProbeInput = {}): Promise<string | null> {
    const env = input.env ?? process.env;
    const platform = input.platform ?? process.platform;
    const windows = platform === "win32";
    const names = windows ? ["gpg.exe", "gpg2.exe"] : ["gpg", "gpg2"];
    const inDirs = (dirs: string[]): string[] => dirs.flatMap(dir => names.map(name => path.join(dir, name)));

    for (const explicit of [input.configuredPath, env.GNUPG_PATH]) {
        const trimmed = explicit?.trim();
        if (!trimmed) {
            continue;
        }
        // Either the binary itself or the directory holding it: both are what
        // people put in a setting that looks like a path, and guessing wrong
        // would tell somebody who has gpg that they do not.
        const found = await firstExistingFile([trimmed, ...inDirs([trimmed])]);
        if (found) {
            return path.resolve(found);
        }
    }

    if (windows) {
        const gpg4win = [env["ProgramFiles(x86)"], env.ProgramFiles, env.ProgramW6432]
            .map(root => root?.trim())
            .filter((root): root is string => Boolean(root))
            .flatMap(root => [path.join(root, "GnuPG", "bin"), path.join(root, "Gpg4win", "bin")]);
        const found = await firstExistingFile(inDirs([...new Set(gpg4win)]));
        if (found) {
            return found;
        }
    }

    const pathDirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).map(dir => dir.trim()).filter(Boolean);
    const onPath = await firstExistingFile(inDirs(pathDirs));
    if (onPath) {
        return onPath;
    }

    if (windows) {
        return findGitBundledGpg(pathDirs);
    }
    const fallback = input.fallbackDirs ?? (platform === "darwin" ? MACOS_GPG_DIRS : []);
    return fallback.length > 0 ? firstExistingFile(inDirs(fallback)) : null;
}

/**
 * The gpg inside a Git for Windows install, located from git itself.
 *
 * git.exe lives at `<root>/cmd/git.exe`, `<root>/bin/git.exe` or
 * `<root>/mingw64/bin/git.exe` depending on which of the install's PATH entries
 * was picked up; gpg is always at `<root>/usr/bin/gpg.exe`.
 */
async function findGitBundledGpg(pathDirs: string[]): Promise<string | null> {
    const gitExe = await firstExistingFile(pathDirs.map(dir => path.join(dir, "git.exe")));
    if (!gitExe) {
        return null;
    }
    const binDir = path.dirname(gitExe);
    const roots = [path.dirname(binDir), path.dirname(path.dirname(binDir))];
    return firstExistingFile(roots.map(root => path.join(root, "usr", "bin", "gpg.exe")));
}

/** Detached-signature file for an artifact: `<artifact>.asc`, beside it. */
export function detachedSignaturePath(artifact: string): string {
    return `${artifact}.asc`;
}

/**
 * Sign every file with `--detach-sign --armor`, writing `<file>.asc` beside it,
 * and hand back the signature paths.
 *
 * Throws on the first failure rather than continuing: an author who configured
 * signing and receives a half-signed release directory has the one outcome this
 * feature exists to prevent, and the artifacts are still on disk either way.
 * gpg's own stderr is surfaced verbatim - a key with a passphrase needs
 * pinentry, which cannot be relied on from a utility process, and "gpg said
 * this" is the only message that lets an author fix that themselves.
 */
export async function signArtifactsWithGpg(
    files: string[],
    gpg: GameBuildWorkerGpgSigning,
    log: Log,
): Promise<string[]> {
    if (files.length === 0) {
        return [];
    }
    const binary = await findGpg({ ...(gpg.gpgPath ? { configuredPath: gpg.gpgPath } : {}) });
    if (!binary) {
        throw new Error(
            "GPG signing was configured for this build, but no gpg binary could be found on this machine. "
            + "Install GnuPG, or set the credential's gpg path.",
        );
    }
    log("info", `signing ${files.length} artifact${files.length === 1 ? "" : "s"} with GPG key ${gpg.keyId}`);
    const signatures: string[] = [];
    for (const file of files) {
        const signature = detachedSignaturePath(file);
        try {
            await execFileAsync(
                binary,
                ["--batch", "--yes", "--detach-sign", "--armor", "--local-user", gpg.keyId, "-o", signature, file],
                {
                    // Deliberately the ambient environment, with no GNUPGHOME of
                    // our own: the key is in the author's keyring, and the gpg
                    // we found may be an MSYS build that rejects a Windows-style
                    // path outright ("':' are not allowed in the socket name").
                    env: process.env,
                    maxBuffer: 4 * 1024 * 1024,
                },
            );
        } catch (error) {
            throw new Error(`GPG could not sign ${path.basename(file)}:\n${gpgFailureDetail(error)}`);
        }
        signatures.push(signature);
    }
    return signatures;
}

/** gpg's own words: its stderr if it produced any, else whatever node reported. */
function gpgFailureDetail(error: unknown): string {
    const stderr = (error as { stderr?: string | Buffer } | null)?.stderr;
    const text = typeof stderr === "string" ? stderr : stderr instanceof Buffer ? stderr.toString("utf8") : "";
    const trimmed = text.trim();
    if (trimmed) {
        return trimmed;
    }
    return error instanceof Error ? error.message : String(error);
}
