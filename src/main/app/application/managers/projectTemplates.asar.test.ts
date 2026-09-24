import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import { scaffoldProjectFromTemplate } from "./projectTemplates";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nls-template-asar-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Scaffolding copies a template's content into a project that has just been created, which is the
 * case the patch is worst at: every folder on the way is new, so a folder named like an archive is
 * one it has never seen as a directory.
 */
describe("scaffolding a template whose content is named like archives", () => {
    it("copies each file into the new project byte for byte", async () => {
        const templatesDir = path.join(root, "templates");
        fs.mkdirSync(path.join(templatesDir, "skeleton"), { recursive: true });
        fs.writeFileSync(path.join(templatesDir, "skeleton", "template.json"), JSON.stringify({ name: "Skeleton" }));
        const bytes = writeArchiveNamedTree(path.join(templatesDir, "skeleton", "content"));
        const projectDir = path.join(root, "project");
        fs.mkdirSync(projectDir);

        const result = await scaffoldProjectFromTemplate(templatesDir, "skeleton", projectDir);

        expect(result.filesCopied).toBe(ARCHIVE_NAMED_FILES.length);
        for (const relative of ARCHIVE_NAMED_FILES) {
            expect(fs.readFileSync(path.join(projectDir, ...relative.split("/"))).equals(bytes[relative])).toBe(true);
        }
    });
});
