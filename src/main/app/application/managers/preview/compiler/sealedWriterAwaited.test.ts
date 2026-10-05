import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const MAIN_ROOT = path.resolve(__dirname, "../../../../..");

function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...sourceFiles(full));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            found.push(full);
        }
    }
    return found;
}

describe("writes into a sealed store", () => {
    /*
     * A sealed store's writer encrypts each entry at the stream offset it has reached, and moves that
     * offset on only once the entry's bytes are on disk. A second `add` that starts before the first
     * has finished therefore encrypts at the same offset, and the index records it one entry further
     * on: the store finalizes, the content check (which asks only that an entry is non-empty) passes,
     * and the game reads that asset back as noise. Whether it happens depends on which of two disk
     * operations finishes first, so no test of a build would catch it reliably. This one reads the
     * source instead.
     */
    it("awaits every add, so no two entries are ever written at once", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(MAIN_ROOT)) {
            const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
            lines.forEach((line, index) => {
                if (/[wW]riter\.add\(/.test(line) && !/\bawait\s+[\w.]*[wW]riter\.add\(/.test(line)) {
                    offenders.push(`${path.relative(MAIN_ROOT, file)}:${index + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
