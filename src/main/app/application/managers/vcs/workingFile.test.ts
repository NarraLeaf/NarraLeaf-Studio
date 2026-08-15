import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPARISON_PREVIEW_BYTE_CEILING } from "./diff/documentDiff";
import { readWorkingSetFile, WorkingFileRefusedError } from "./workingFile";

/**
 * What this verb will not read.
 *
 * It exists to put a sprite on screen, and the way that becomes a hole is by being helpful: a
 * renderer asking for `../../.ssh/id_rsa`, for `.nlstudio/settings.json`, or for a 300 MB video
 * that would be base64-encoded across the process boundary before anyone noticed. So the three
 * guards get a test each, and each asserts the REFUSAL rather than an absence - a read that
 * silently answered with nothing would look identical to a file that is not there.
 */

let project: string;

function write(relative: string, bytes: string | Buffer): void {
    const absolute = path.join(project, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
}

async function refusalOf(relative: string, limit?: number): Promise<WorkingFileRefusedError> {
    try {
        await readWorkingSetFile(project, relative, limit === undefined ? {} : { limit });
    } catch (error) {
        if (error instanceof WorkingFileRefusedError) {
            return error;
        }
        throw error;
    }
    throw new Error(`reading ${relative} was allowed`);
}

beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-working-file-")));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("reading one file out of the working tree", () => {
    it("answers with the bytes of a versioned file", async () => {
        write("assets/content/ab/cd/sprite", Buffer.from([0x89, 0x50, 0x4e, 0x47]));

        const bytes = await readWorkingSetFile(project, "assets/content/ab/cd/sprite");

        expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it("accepts either separator, because a caller on Windows has both spellings", async () => {
        write("editor/story/index.json", "{}");

        await expect(readWorkingSetFile(project, "editor\\story\\index.json")).resolves.toEqual(Buffer.from("{}"));
    });
});

describe("what it refuses", () => {
    it("refuses a path that leaves the project directory", async () => {
        // Written where the escape would land, so a read that got through would succeed rather
        // than fail on ENOENT and look like the guard had worked.
        fs.writeFileSync(path.join(path.dirname(project), "outside.png"), "secret");

        expect((await refusalOf("../outside.png")).refusal).toBe("escapes");
        expect((await refusalOf("assets/../../outside.png")).refusal).toBe("escapes");
        expect((await refusalOf(path.join(path.dirname(project), "outside.png"))).refusal).toBe("escapes");
    });

    it("refuses a path outside the working set, even though it is right there on disk", async () => {
        write(".nlstudio/settings.json", "{}");
        write("node_modules/pkg/index.js", "module.exports = 1;");

        expect((await refusalOf(".nlstudio/settings.json")).refusal).toBe("excluded");
        expect((await refusalOf("node_modules/pkg/index.js")).refusal).toBe("excluded");
    });

    it("refuses a file past the ceiling instead of answering with part of it", async () => {
        write("assets/content/ab/cd/huge", Buffer.alloc(2048));

        const refused = await refusalOf("assets/content/ab/cd/huge", 1024);

        expect(refused.refusal).toBe("tooLarge");
        // The number is in the message: an author is told a file is too large, and whoever is
        // asked why has to be able to find out what it was measured against.
        expect(refused.message).toContain("2048");
        expect(refused.message).toContain("1024");
    });

    it("defaults the ceiling to the one the comparison surface budgets against", async () => {
        expect(COMPARISON_PREVIEW_BYTE_CEILING).toBe(16 * 1024 * 1024);
        write("assets/content/ab/cd/small", Buffer.alloc(16));

        await expect(readWorkingSetFile(project, "assets/content/ab/cd/small")).resolves.toHaveLength(16);
    });
});
