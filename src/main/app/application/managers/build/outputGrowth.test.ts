import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureTree, watchOutputGrowth } from "./outputGrowth";

/**
 * The sign a headless build reads as "still packaging" when nothing has been logged for a long
 * time: the output folder changing size. A wrong answer either way is expensive - a build that is
 * abandoned while 7-Zip is still compressing, or one that hangs forever because a folder that will
 * never change again is read as busy.
 */

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-output-growth-"));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const look = (): void => {
            if (condition()) {
                resolve();
            } else if (Date.now() - started > timeoutMs) {
                reject(new Error("timed out"));
            } else {
                setTimeout(look, 5);
            }
        };
        look();
    });
}

describe("measureTree", () => {
    it("counts every file under the folder, nested ones included", async () => {
        await fs.mkdir(path.join(dir, "win-unpacked", "resources"), { recursive: true });
        await fs.writeFile(path.join(dir, "game.zip"), Buffer.alloc(100));
        await fs.writeFile(path.join(dir, "win-unpacked", "game.exe"), Buffer.alloc(20));
        await fs.writeFile(path.join(dir, "win-unpacked", "resources", "assets.bin"), Buffer.alloc(3));
        expect(await measureTree(dir)).toBe(123);
    });

    it("answers 0 for a folder that is not there yet", async () => {
        expect(await measureTree(path.join(dir, "not-yet"))).toBe(0);
    });

    it("does not follow links, so a bundle's links back into itself are not counted twice", async () => {
        await fs.mkdir(path.join(dir, "Versions", "A"), { recursive: true });
        await fs.writeFile(path.join(dir, "Versions", "A", "Framework"), Buffer.alloc(50));
        try {
            await fs.symlink(path.join(dir, "Versions", "A"), path.join(dir, "Current"), "junction");
        } catch {
            // A host that refuses to make the link has nothing to prove here.
            return;
        }
        expect(await measureTree(dir)).toBe(50);
    });
});

describe("watchOutputGrowth", () => {
    it("reports a file being written, and nothing once it stops changing", async () => {
        let changes = 0;
        const stop = watchOutputGrowth(dir, () => { changes += 1; }, 20);
        try {
            // Long enough for the first look, which only takes the measure.
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(changes).toBe(0);

            const handle = await fs.open(path.join(dir, "game-setup.nsis.7z"), "w");
            await handle.write(Buffer.alloc(1024));
            await waitFor(() => changes >= 1);
            await handle.write(Buffer.alloc(1024));
            await waitFor(() => changes >= 2);
            await handle.close();

            const settled = changes;
            await new Promise(resolve => setTimeout(resolve, 120));
            expect(changes).toBe(settled);
        } finally {
            stop();
        }
    });

    it("says nothing after it has been stopped", async () => {
        let changes = 0;
        const stop = watchOutputGrowth(dir, () => { changes += 1; }, 20);
        await new Promise(resolve => setTimeout(resolve, 60));
        stop();
        await fs.writeFile(path.join(dir, "late.zip"), Buffer.alloc(10));
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(changes).toBe(0);
    });
});
