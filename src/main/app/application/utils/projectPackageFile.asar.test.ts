import os from "os";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import { readProjectPackageInto, writeProjectPackage } from "./projectPackageFile";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. This is the path the patch was
// first found on - exporting a project that held a packaged build - and until the patch could be
// reproduced here nothing but a real Studio could tell whether it was fixed.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function scratch(name: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `nlspkg-asar-${name}-`));
    roots.push(root);
    return root;
}

describe("a project package carrying author files named like archives", () => {
    it("exports them and imports them back byte for byte", async () => {
        const projectRoot = scratch("project");
        fs.writeFileSync(path.join(projectRoot, "Demo.nlproj"), "config");
        const bytes = writeArchiveNamedTree(projectRoot);
        const packagePath = path.join(scratch("out"), "Demo.nlspkg");

        const written = await writeProjectPackage({
            projectRoot,
            packagePath,
            projectName: "Demo",
            projectIdentifier: "com.example.demo",
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        expect(written.fileCount).toBe(1 + ARCHIVE_NAMED_FILES.length);

        // Imported into a folder that does not exist yet and is itself named like an archive: the
        // unpack has to create it, and every folder below it, before a single file can land.
        const target = path.join(scratch("import"), "Imported.asar");
        await readProjectPackageInto(packagePath, target);

        for (const relative of ARCHIVE_NAMED_FILES) {
            expect(fs.readFileSync(path.join(target, ...relative.split("/"))).equals(bytes[relative])).toBe(true);
        }
    });
});
