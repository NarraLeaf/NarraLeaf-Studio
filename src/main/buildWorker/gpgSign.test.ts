import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { MACOS_GPG_DIRS, detachedSignaturePath, findGpg, signArtifactsWithGpg } from "./gpgSign";

/**
 * Two halves. The discovery is judged against a synthetic tree, so it says the
 * same thing on every machine. The signing itself needs a real gpg and a real
 * key, so it is gated on NLS_GPG_ORACLE_KEY (a throwaway key id, with
 * GNUPGHOME pointing at its keyring): it skips on CI and on a fresh checkout,
 * and runs for anyone who sets those two up. REQUIRE_GPG_ORACLE=1 turns a
 * missing gpg into a failure, so a host that was meant to run it cannot pass by
 * silently skipping.
 */

const dirs: string[] = [];
const noop = (): void => undefined;

afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function tempTree(files: string[] = []): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-gpg-"));
    dirs.push(root);
    for (const file of files) {
        const target = path.join(root, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, "");
    }
    return root;
}

function at(root: string, relative: string): string {
    return path.join(root, ...relative.split("/"));
}

describe("findGpg", () => {
    it("takes the credential's own path, as the file or as its directory", async () => {
        const root = await tempTree(["vault/gpg.exe"]);
        expect(await findGpg({ configuredPath: at(root, "vault/gpg.exe"), env: {}, platform: "win32" }))
            .toBe(at(root, "vault/gpg.exe"));
        expect(await findGpg({ configuredPath: at(root, "vault"), env: {}, platform: "win32" }))
            .toBe(at(root, "vault/gpg.exe"));
    });

    it("prefers a native Gpg4win install over anything on PATH", async () => {
        // Git's gpg is an MSYS build with POSIX path semantics; when a host has
        // both, the native one is the one that behaves like Windows.
        const root = await tempTree(["PF/GnuPG/bin/gpg.exe", "onpath/gpg.exe"]);
        expect(await findGpg({
            env: { ProgramFiles: at(root, "PF"), PATH: at(root, "onpath") },
            platform: "win32",
        })).toBe(at(root, "PF/GnuPG/bin/gpg.exe"));
    });

    it("reads GNUPG_PATH ahead of both", async () => {
        const root = await tempTree(["custom/gpg.exe", "PF/GnuPG/bin/gpg.exe"]);
        expect(await findGpg({
            env: { GNUPG_PATH: at(root, "custom"), ProgramFiles: at(root, "PF") },
            platform: "win32",
        })).toBe(at(root, "custom/gpg.exe"));
    });

    it("derives Git for Windows' bundled gpg, which no PATH search can find", async () => {
        // The real shape of this machine: Git outside Program Files, gpg under
        // usr/bin, and only Git's cmd directory on PATH.
        const root = await tempTree(["Program/Git/cmd/git.exe", "Program/Git/usr/bin/gpg.exe"]);
        expect(await findGpg({ env: { PATH: at(root, "Program/Git/cmd") }, platform: "win32" }))
            .toBe(at(root, "Program/Git/usr/bin/gpg.exe"));

        const mingw = await tempTree(["Git/mingw64/bin/git.exe", "Git/usr/bin/gpg.exe"]);
        expect(await findGpg({ env: { PATH: at(mingw, "Git/mingw64/bin") }, platform: "win32" }))
            .toBe(at(mingw, "Git/usr/bin/gpg.exe"));
    });

    it("takes a gpg on PATH before falling back to git's", async () => {
        const root = await tempTree(["onpath/gpg.exe", "Git/cmd/git.exe", "Git/usr/bin/gpg.exe"]);
        expect(await findGpg({
            env: { PATH: [at(root, "onpath"), at(root, "Git/cmd")].join(path.delimiter) },
            platform: "win32",
        })).toBe(at(root, "onpath/gpg.exe"));
    });

    it("looks for unsuffixed names off Windows, and never for git's gpg", async () => {
        const root = await tempTree(["bin/gpg2", "Git/cmd/git.exe", "Git/usr/bin/gpg.exe"]);
        expect(await findGpg({ env: { PATH: at(root, "bin") }, platform: "linux" }))
            .toBe(at(root, "bin/gpg2"));
        expect(await findGpg({ env: { PATH: at(root, "Git/cmd") }, platform: "linux" })).toBeNull();
    });

    it("finds a macOS install that PATH does not mention", async () => {
        // launchd hands a double-clicked app a PATH of /usr/bin:/bin:/usr/sbin:/sbin
        // and nothing else, so every way of installing gpg on a Mac is invisible
        // to a PATH search. Without this arm the same machine answers differently
        // depending on whether Studio was started from a terminal.
        //
        // The PATH is a synthetic empty directory rather than the literal
        // "/usr/bin:/bin" launchd would hand over: on a host that really does
        // have /usr/bin/gpg - every Linux CI runner - the real binary is found
        // first and the fallback this test exists to cover never runs. What the
        // case needs is only that PATH mention no gpg.
        const root = await tempTree(["opt/homebrew/bin/gpg", "launchd-path/.keep"]);
        expect(await findGpg({
            env: { PATH: at(root, "launchd-path") },
            platform: "darwin",
            fallbackDirs: [at(root, "opt/homebrew/bin")],
        })).toBe(at(root, "opt/homebrew/bin/gpg"));
    });

    it("still prefers a gpg on PATH over the macOS fallback", async () => {
        const root = await tempTree(["onpath/gpg", "opt/homebrew/bin/gpg"]);
        expect(await findGpg({
            env: { PATH: at(root, "onpath") },
            platform: "darwin",
            fallbackDirs: [at(root, "opt/homebrew/bin")],
        })).toBe(at(root, "onpath/gpg"));
    });

    it("names the four ways a Mac gets gpg, in install-prevalence order", () => {
        // Homebrew on Apple Silicon, Homebrew on Intel, MacPorts, GPG Suite.
        expect(MACOS_GPG_DIRS).toEqual([
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/usr/local/MacGPG2/bin",
        ]);
    });

    it("finds nothing on a host without gpg", async () => {
        const root = await tempTree(["bin/notes.txt"]);
        expect(await findGpg({ env: { PATH: at(root, "bin") }, platform: "win32" })).toBeNull();
    });
});

describe("detachedSignaturePath", () => {
    it("keeps the artifact's own extension, as every release directory does", () => {
        // game-1.0.0.exe.asc, not game-1.0.0.asc: the name has to say which file
        // it signs when a directory holds a dozen of them.
        expect(detachedSignaturePath("/out/game-1.0.0.exe")).toBe("/out/game-1.0.0.exe.asc");
    });
});

const oracleKey = process.env.NLS_GPG_ORACLE_KEY?.trim();
const gpgBinary = await findGpg();

if (process.env.REQUIRE_GPG_ORACLE === "1" && !gpgBinary) {
    throw new Error("REQUIRE_GPG_ORACLE=1 but no gpg binary was found on this host");
}

describe.skipIf(!oracleKey || !gpgBinary)("the gpg oracle", () => {
    it("produces a signature gpg itself accepts, and rejects after one flipped byte", async () => {
        const dir = await tempTree();
        const artifact = path.join(dir, "game-1.0.0.zip");
        await fs.writeFile(artifact, Buffer.alloc(4096, 7));

        const [signature] = await signArtifactsWithGpg([artifact], { keyId: oracleKey! }, noop);
        expect(signature).toBe(`${artifact}.asc`);
        expect(await fs.readFile(signature, "utf8")).toContain("-----BEGIN PGP SIGNATURE-----");

        const verify = (): string =>
            execFileSync(gpgBinary!, ["--batch", "--verify", signature, artifact], { encoding: "utf8", stdio: "pipe" });
        expect(verify).not.toThrow();

        const tampered = await fs.readFile(artifact);
        tampered[2048] ^= 0xff;
        await fs.writeFile(artifact, tampered);
        expect(verify).toThrow(/BAD signature/);
    });
});
