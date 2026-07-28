import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ARTIFACT_DIGEST_FILE_NAME, formatArtifactDigests, writeArtifactDigests } from "./artifactDigests";

/**
 * The digests are checked against NIST's published SHA-256 vectors rather than
 * against another call to `createHash`: hashing the same bytes twice with the
 * same function cannot tell us the file says what a player's `sha256sum -c`
 * will say.
 */
const VECTORS = {
    "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
};

const dirs: string[] = [];
const noop = (): void => undefined;

afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-digests-"));
    dirs.push(dir);
    return dir;
}

describe("formatArtifactDigests", () => {
    it("writes sha256sum's own format: two spaces, sorted, newline-terminated", () => {
        expect(formatArtifactDigests([
            { name: "z.zip", sha256: "bb" },
            { name: "a.exe", sha256: "aa" },
            { name: "web/index.html", sha256: "cc" },
        ])).toBe("aa  a.exe\ncc  web/index.html\nbb  z.zip\n");
    });
});

describe("writeArtifactDigests", () => {
    it("hashes every artifact, naming it relative to the output directory", async () => {
        const dir = await tempDir();
        await fs.writeFile(path.join(dir, "game.exe"), "abc");
        await fs.mkdir(path.join(dir, "web"), { recursive: true });
        await fs.writeFile(path.join(dir, "web", "site.zip"), "");

        const result = await writeArtifactDigests(
            [path.join(dir, "game.exe"), path.join(dir, "web", "site.zip")],
            dir,
            noop,
        );

        expect(result.path).toBe(path.join(dir, ARTIFACT_DIGEST_FILE_NAME));
        expect(await fs.readFile(result.path!, "utf8")).toBe(
            `${VECTORS.abc}  game.exe\n${VECTORS[""]}  web/site.zip\n`,
        );
        expect(result.files).toEqual([path.join(dir, "game.exe"), path.join(dir, "web", "site.zip")]);
    });

    it("skips directories, duplicates, signatures and a previous sums file", async () => {
        const dir = await tempDir();
        await fs.writeFile(path.join(dir, "game.exe"), "abc");
        await fs.writeFile(path.join(dir, "game.exe.asc"), "-----BEGIN PGP SIGNATURE-----");
        await fs.writeFile(path.join(dir, ARTIFACT_DIGEST_FILE_NAME), "stale");
        await fs.mkdir(path.join(dir, "win-unpacked"), { recursive: true });

        const result = await writeArtifactDigests(
            [
                path.join(dir, "game.exe"),
                path.join(dir, "game.exe"),
                path.join(dir, "game.exe.asc"),
                path.join(dir, ARTIFACT_DIGEST_FILE_NAME),
                path.join(dir, "win-unpacked"),
            ],
            dir,
            noop,
        );

        expect(await fs.readFile(result.path!, "utf8")).toBe(`${VECTORS.abc}  game.exe\n`);
        expect(result.files).toEqual([path.join(dir, "game.exe")]);
    });

    it("writes nothing when a build produced no hashable file", async () => {
        const dir = await tempDir();
        await fs.mkdir(path.join(dir, "win-unpacked"), { recursive: true });

        const result = await writeArtifactDigests([path.join(dir, "win-unpacked")], dir, noop);

        expect(result).toEqual({ path: null, files: [] });
        await expect(fs.access(path.join(dir, ARTIFACT_DIGEST_FILE_NAME))).rejects.toThrow();
    });

    it("warns about an artifact that vanished rather than failing the build", async () => {
        const dir = await tempDir();
        await fs.writeFile(path.join(dir, "game.exe"), "abc");
        const warnings: string[] = [];

        const result = await writeArtifactDigests(
            [path.join(dir, "game.exe"), path.join(dir, "gone.zip")],
            dir,
            (level, message) => {
                if (level === "warning") {
                    warnings.push(message);
                }
            },
        );

        expect(await fs.readFile(result.path!, "utf8")).toBe(`${VECTORS.abc}  game.exe\n`);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("gone.zip");
    });
});
