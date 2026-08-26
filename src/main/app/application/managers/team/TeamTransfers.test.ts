import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { afterEach, describe, expect, it } from "vitest";

import { JOURNAL, TeamTransfers, measure, partial, slowly, type TeamTransferDeps } from "./TeamTransfers";
import { fileIsInProject } from "../window/handlers/teamAction";

/**
 * Moving a file between a project and a server.
 *
 * What can be asserted without a server is the half that decides whether a file is ever read or
 * written at all, and it is the half worth guarding: the boundary a path is held to, the
 * fingerprint a file is verified by, and the journal that turns "this was interrupted" into "this
 * is picked up again". The other half - the five requests themselves - is asserted against a real
 * one in the Team repository's own suite, and end to end on two machines.
 */

const made: string[] = [];

afterEach(async () => {
    while (made.length > 0) {
        const directory = made.pop();
        if (directory !== undefined) {
            await fs.rm(directory, { recursive: true, force: true });
        }
    }
});

async function temporary(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nls-transfers-"));
    made.push(directory);
    return directory;
}

/** An engine that can reach no server, so nothing here opens a socket. */
function engine(userDataDir: string, said: string[] = []): TeamTransfers {
    const deps: TeamTransferDeps = {
        authUrlFor: () => null,
        tokenFor: () => "a-token",
        installation: () => "installation-1",
        userDataDir: () => userDataDir,
        log: (line) => said.push(line),
        slow: () => false,
    };
    return new TeamTransfers(deps);
}

describe("measuring a file", () => {
    it("hashes what is on disk without reading it into anything", async () => {
        const directory = await temporary();
        const file = path.join(directory, "asset.bin");
        // Comfortably more than one read buffer, so this exercises the streaming rather than a
        // single chunk that happens to be the whole file.
        const bytes = randomBytes(3 * 1024 * 1024);
        await fs.writeFile(file, bytes);

        const measured = await measure(file);
        expect(measured.size).toBe(bytes.length);
        expect(measured.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
    });

    it("measures an empty file rather than refusing it", async () => {
        const directory = await temporary();
        const file = path.join(directory, "empty.bin");
        await fs.writeFile(file, Buffer.alloc(0));

        const measured = await measure(file);
        expect(measured.size).toBe(0);
        expect(measured.digest).toBe(createHash("sha256").digest("hex"));
    });
});

describe("a transfer that cannot reach its server", () => {
    it("refuses an offer by name rather than starting something that cannot finish", async () => {
        const directory = await temporary();
        const file = path.join(directory, "asset.bin");
        await fs.writeFile(file, randomBytes(64));

        const answered = await engine(directory).handle({
            action: "offer",
            remoteOrigin: "nlteam://nowhere",
            project: "p1",
            transferId: "t1",
            label: "asset-1",
            source: file,
        });
        expect(answered.ok).toBe(false);
        if (!answered.ok) {
            expect(answered.problem.kind).toBe("unavailable");
        }
    });

    it("takes a collection and then gives up on it, rather than asking for ever", async () => {
        const directory = await temporary();
        const transfers = engine(directory);
        const answered = await transfers.handle({
            action: "collect",
            remoteOrigin: "nlteam://nowhere",
            project: "p1",
            transferId: "t2",
            label: "asset-2",
            destination: path.join(directory, "content", "asset-2.png"),
            size: 128,
            digest: "abc",
        });
        expect(answered).toEqual({ ok: true, kind: "accepted" });

        const views = transfers.views();
        expect(views).toHaveLength(1);
        expect(views[0]?.label).toBe("asset-2");
        // Stopped rather than retried: no address is not a server that might come back.
        expect(views[0]?.state).toBe("failed");
    });
});

describe("what a restart picks up", () => {
    it("writes down what is in flight, and reads it back as something to pick up", async () => {
        const directory = await temporary();
        const first = engine(directory);
        await first.handle({
            action: "collect",
            remoteOrigin: "nlteam://elsewhere",
            project: "p1",
            transferId: "t3",
            label: "asset-3",
            destination: path.join(directory, "content", "asset-3.png"),
            size: 4096,
            digest: "def",
        });
        // The journal is written behind the answer, so give the queued write its turn.
        await new Promise<void>((settle) => setTimeout(settle, 20));
        const written = await fs.readFile(path.join(directory, JOURNAL), "utf-8");
        expect(written).toContain("t3");
        expect(written).toContain("asset-3");

        // A second run of Studio, with no memory but the journal.
        const second = engine(directory);
        await second.handle({ action: "status" });
        const views = second.views();
        expect(views.map((each) => each.transferId)).toEqual(["t3"]);
        expect(views[0]?.total).toBe(4096);
    });

    it("does not pick anything up until a window says which project it is in", async () => {
        const directory = await temporary();
        const first = engine(directory);
        await first.handle({
            action: "collect",
            remoteOrigin: "nlteam://elsewhere",
            project: "p1",
            transferId: "t4",
            label: "asset-4",
            destination: path.join(directory, "content", "asset-4.png"),
            size: 4096,
            digest: "def",
        });
        await new Promise<void>((settle) => setTimeout(settle, 20));

        const second = engine(directory);
        const answered = await second.handle({
            action: "resume",
            remoteOrigin: "nlteam://elsewhere",
            project: "p1",
        });
        expect(answered).toEqual({ ok: true, kind: "accepted", count: 1 });

        // A different project's resume touches nothing.
        const third = engine(directory);
        const other = await third.handle({
            action: "resume",
            remoteOrigin: "nlteam://elsewhere",
            project: "p2",
        });
        expect(other).toEqual({ ok: true, kind: "accepted", count: 0 });
    });

    it("ignores a journal line that is not one, rather than starting with none", async () => {
        const directory = await temporary();
        await fs.writeFile(
            path.join(directory, JOURNAL),
            JSON.stringify([
                { remoteOrigin: "nlteam://x", project: "p", transferId: "good", direction: "in", localPath: "a", size: 1, digest: "d" },
                { remoteOrigin: "nlteam://x", project: "p", transferId: "bad", direction: "sideways", localPath: "a", size: 1, digest: "d" },
                { transferId: "worse" },
                "not an object",
            ]),
            "utf-8",
        );
        const transfers = engine(directory);
        await transfers.handle({ action: "status" });
        expect(transfers.views().map((each) => each.transferId)).toEqual(["good"]);
    });
});

describe("abandoning", () => {
    it("takes out the half of a file that had already landed", async () => {
        const directory = await temporary();
        const destination = path.join(directory, "content", "asset-5.png");
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(partial(destination), randomBytes(500));

        const transfers = engine(directory);
        await transfers.handle({
            action: "collect",
            remoteOrigin: "nlteam://nowhere",
            project: "p1",
            transferId: "t5",
            label: "asset-5",
            destination,
            size: 4096,
            digest: "def",
        });
        await transfers.handle({
            action: "abandon",
            remoteOrigin: "nlteam://nowhere",
            project: "p1",
            transferIds: ["t5"],
        });

        expect(transfers.views()).toHaveLength(0);
        // ⚠ Half a file beside where the whole one belongs is exactly the orphan this is here to
        // stop: nothing in the library names it and nothing else would ever remove it.
        await expect(fs.stat(partial(destination))).rejects.toThrow();
    });

    it("is asked about transfers it has never heard of, and says so without failing", async () => {
        const directory = await temporary();
        const answered = await engine(directory).handle({
            action: "abandon",
            remoteOrigin: "nlteam://nowhere",
            project: "p1",
            transferIds: ["never-seen"],
        });
        // Every machine in a room applies the deletion that cancels an import, and most of them were
        // not carrying the file.
        expect(answered).toEqual({ ok: true, kind: "accepted", count: 0 });
    });
});

describe("sending slowly enough to watch", () => {
    it("passes every byte through unchanged, which is the only thing it may not alter", async () => {
        const bytes = randomBytes(300_000);
        const out: Buffer[] = [];
        const sink = new (await import("node:stream")).Writable({
            write(chunk: Buffer, _encoding, done): void {
                out.push(chunk);
                done();
            },
        });
        await pipeline(Readable.from([bytes]), slowly(1024 * 1024), sink);
        expect(Buffer.concat(out).equals(bytes)).toBe(true);
    });
});

describe("the boundary a path is held to", () => {
    const project = path.resolve("/projects/lantern");

    it("takes a file inside the project this window has open", () => {
        expect(fileIsInProject(project, path.join(project, "assets", "content", "a.png"))).toBe(true);
    });

    it("refuses one that climbs out of it", () => {
        expect(fileIsInProject(project, path.join(project, "..", "secrets.txt"))).toBe(false);
    });

    it("refuses a sibling whose name begins with the project's", () => {
        // ⚠ The comparison is at a separator: `lantern-house` is not inside `lantern`.
        expect(fileIsInProject(project, path.resolve("/projects/lantern-house/x.png"))).toBe(false);
    });

    it("refuses everything for a window with no project, because there is nothing to be inside", () => {
        expect(fileIsInProject(undefined, path.join(project, "a.png"))).toBe(false);
        expect(fileIsInProject("", path.join(project, "a.png"))).toBe(false);
    });
});
