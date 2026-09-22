import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, asarArchiveBytes, unsimulatedFs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import type { RevisionFileEntry } from "./revisionReader";
import { applyRevisionRestore, planRevisionRestore, readWorkingSetPaths } from "./revisionRestore";
import { materializeRevisionSnapshot } from "./revisionSnapshot";
import { readWorkingSetFile } from "./workingFile";
import { collectWorkingSet } from "./workingSet";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. Plain node has no patch, so without
// this every case below would pass against code that still read the working tree through it.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

/**
 * The working tree is the author's, so a file in it named `bundle.asar` or a folder named `old.asar/`
 * is ordinary content: it is listed, read, restored and removed like any other file. Lore does the
 * committing itself, natively, where the patch does not reach - what is tested here is every part of
 * version control that Studio does in JavaScript.
 */

const REVISION_HASH = "a".repeat(64);

let project: string;

function entry(relative: string, size: number): RevisionFileEntry {
    return { path: relative, size, hash: REVISION_HASH, context: "b".repeat(64) };
}

function onDisk(relative: string): Buffer | null {
    const absolute = path.join(project, ...relative.split("/"));
    return unsimulatedFs.existsSync(absolute) ? unsimulatedFs.readFileSync(absolute) : null;
}

beforeEach(() => {
    project = unsimulatedFs.realpathSync(unsimulatedFs.mkdtempSync(path.join(os.tmpdir(), "nls-vcs-asar-")));
});

afterEach(() => {
    unsimulatedFs.rmSync(project, { recursive: true, force: true });
});

describe("version control over author files named like archives", () => {
    it("lists them as the versioned files they are", async () => {
        writeArchiveNamedTree(project);

        expect((await readWorkingSetPaths(project)).sort()).toEqual([...ARCHIVE_NAMED_FILES].sort());
        expect((await collectWorkingSet(project)).sort()).toEqual(
            ARCHIVE_NAMED_FILES.map(relative => path.join(project, ...relative.split("/"))).sort(),
        );
    });

    it("reads each one's bytes for the comparison view", async () => {
        const bytes = writeArchiveNamedTree(project);

        for (const relative of ARCHIVE_NAMED_FILES) {
            expect((await readWorkingSetFile(project, relative)).equals(bytes[relative])).toBe(true);
        }
    });

    /**
     * The round trip a restore makes: the archive is replaced by another, the folder named like one
     * is gone altogether, and a second archive the revision never had has appeared. Putting the
     * revision back means writing into a folder that is not there yet and deleting an archive by name
     * - the two things the patch refuses.
     */
    it("restores a revision that holds them, and removes one the revision never had", async () => {
        const revision = writeArchiveNamedTree(project);
        const revisionEntries = ARCHIVE_NAMED_FILES.map(relative => entry(relative, revision[relative].length));
        unsimulatedFs.rmSync(path.join(project, "old.asar"), { recursive: true, force: true });
        unsimulatedFs.writeFileSync(path.join(project, "bundle.asar"), asarArchiveBytes({ "other.txt": "a later archive" }));
        unsimulatedFs.writeFileSync(path.join(project, "extra.asar"), asarArchiveBytes({ "extra.txt": "added since" }));

        const plan = planRevisionRestore({ revision: revisionEntries, working: await readWorkingSetPaths(project) });
        expect(plan.remove).toEqual(["extra.asar"]);

        const result = await applyRevisionRestore({
            projectPath: project,
            plan,
            source: { read: async (e) => revision[e.path as keyof typeof revision] },
        });

        expect(result.filesWritten).toBe(ARCHIVE_NAMED_FILES.length);
        expect(result.filesRemoved).toBe(1);
        for (const relative of ARCHIVE_NAMED_FILES) {
            expect(onDisk(relative)?.equals(revision[relative])).toBe(true);
        }
        expect(onDisk("extra.asar")).toBeNull();
    });

    it("materialises a past revision holding them for Dev Mode", async () => {
        const revision = writeArchiveNamedTree(path.join(project, "incoming"));
        const entries = ARCHIVE_NAMED_FILES.map(relative => entry(relative, revision[relative].length));

        const result = await materializeRevisionSnapshot({
            projectPath: project,
            revision: "c".repeat(64),
            source: {
                list: async () => entries,
                read: async (e) => revision[e.path as keyof typeof revision],
            },
        });

        expect(result.files).toBe(ARCHIVE_NAMED_FILES.length);
        for (const relative of ARCHIVE_NAMED_FILES) {
            const written = unsimulatedFs.readFileSync(path.join(result.directory, ...relative.split("/")));
            expect(written.equals(revision[relative])).toBe(true);
        }
    });
});
