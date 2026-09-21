/**
 * No node builds a widget address itself; they all ask `addressWidgetFromExecution`.
 *
 * The address of a node's target depends on whether the target is drawn in the row or placement the
 * graph is running in, and only the runtime can tell (`widgetDrawing.ts`). A node that went back to
 * `buildUIWidgetAddress(id, instanceKey)` would compile, pass every test that does not run it inside a
 * list row, and quietly send a row's writes to the outside of the list nowhere again. When the rule
 * arrived the expression was spelled in eight modules, readers and writers apart, and fixing any one
 * of them would have left the rest writing where the fixed one no longer read.
 *
 * So the spelling is allowed in one file under `blueprint-nodes/`, and this is what says so.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NODES_ROOT = path.resolve(__dirname, "..");
const THE_ONE_PLACE = path.join(NODES_ROOT, "built-in", "widgetTarget.ts");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(full);
        }
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

describe("widget addresses in blueprint nodes", () => {
    it("are built in widgetTarget.ts and nowhere else", () => {
        const builders = sourceFiles(NODES_ROOT).filter(file => /\bbuildUIWidgetAddress\b/.test(fs.readFileSync(file, "utf-8")));

        expect(builders.map(file => path.relative(NODES_ROOT, file))).toEqual([path.relative(NODES_ROOT, THE_ONE_PLACE)]);
    });
});
