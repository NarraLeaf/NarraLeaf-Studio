import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLocalRepository, readRemoteOrigin, readRepositoryId } from "./localRepositories";

/**
 * Which repository a folder on this disk is a copy of, read without opening it.
 *
 * The two things this has to keep getting right are the two shapes of `remote_url` a real
 * config carries - creating a repository stores only the origin, Studio's own setRemote
 * writes the whole address - and the fact that everything here is optional. A folder with
 * no repository, or one whose files cannot be read, is still a project the author has; it
 * simply has nothing to match a server's list against, and that has to come back as
 * nothing rather than as an id of some other shape.
 */

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-local-repo-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

/** A repository as Lore leaves one: a sixteen-byte id and a config beside it. */
async function repository(options: { id?: Buffer; config?: string } = {}): Promise<void> {
    const directory = path.join(root, ".lore");
    await fs.mkdir(directory, { recursive: true });
    if (options.id !== undefined) {
        await fs.writeFile(path.join(directory, "id"), options.id);
    }
    if (options.config !== undefined) {
        await fs.writeFile(path.join(directory, "config.toml"), options.config, "utf-8");
    }
}

const ID = Buffer.from("019fda5ba4fe799096aaab7585aa4722", "hex");

describe("the repository id", () => {
    it("reads the sixteen bytes back as the hex a server lists a project under", async () => {
        await repository({ id: ID });

        expect(readRepositoryId(root)).toBe("019fda5ba4fe799096aaab7585aa4722");
    });

    it("is nothing for a folder that is not under version control", () => {
        expect(readRepositoryId(root)).toBeUndefined();
    });

    it("is nothing for a file of the wrong length, which is not this file", async () => {
        await repository({ id: Buffer.from("0102", "hex") });

        expect(readRepositoryId(root)).toBeUndefined();
    });
});

describe("the server a project is configured against", () => {
    it("reads a config that holds only the origin, which is what creating one writes", async () => {
        await repository({ config: 'remote_url = "lore://team.example.lan:41337"\n[store]\n' });

        expect(readRemoteOrigin(root)).toBe("lore://team.example.lan:41337");
    });

    it("takes the repository name off an address Studio wrote in full", async () => {
        await repository({ config: 'remote_url = "lore://team.example.lan:41337/moonlit"\n' });

        expect(readRemoteOrigin(root)).toBe("lore://team.example.lan:41337");
    });

    it("reads both placeholders as no server at all", async () => {
        await repository({ config: 'remote_url = "lore://unconfigured.invalid"\n' });
        expect(readRemoteOrigin(root)).toBeUndefined();

        await repository({ config: 'remote_url = "lore://127.0.0.1:41337"\n' });
        expect(readRemoteOrigin(root)).toBeUndefined();
    });

    it("is nothing when the config names no remote", async () => {
        await repository({ config: "[store]\nmax_capacity = 2000000\n" });

        expect(readRemoteOrigin(root)).toBeUndefined();
    });

    it("does not match the key inside a value or a comment", async () => {
        await repository({ config: '# remote_url = "lore://decoy.example.lan:41337"\nidentity = "remote_url"\n' });

        expect(readRemoteOrigin(root)).toBeUndefined();
    });
});

describe("one project", () => {
    it("carries its path and name back whether or not there was anything to read", async () => {
        const unversioned = readLocalRepository({ path: root, name: "Moonlit" });

        expect(unversioned).toEqual({ path: root, name: "Moonlit" });
    });

    it("keeps the path spelled as the author's history holds it", async () => {
        await repository({ id: ID, config: 'remote_url = "lore://team.example.lan:41337/moonlit"\n' });

        expect(readLocalRepository({ path: root, name: "Moonlit" })).toEqual({
            path: root,
            name: "Moonlit",
            repositoryId: "019fda5ba4fe799096aaab7585aa4722",
            remoteOrigin: "lore://team.example.lan:41337",
        });
    });
});
