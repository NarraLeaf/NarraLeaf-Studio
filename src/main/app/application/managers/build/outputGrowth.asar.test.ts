import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import { measureTree } from "./outputGrowth";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. A directory build writes the game's
// own `resources/app.asar`, which the watcher measures while it is still being written.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-output-growth-asar-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("measureTree over files named like archives", () => {
    it("counts their bytes as plain files", async () => {
        const written = writeArchiveNamedTree(dir);
        const expected = Object.values(written).reduce((total, bytes) => total + bytes.length, 0);
        expect(await measureTree(dir)).toBe(expected);
    });
});
