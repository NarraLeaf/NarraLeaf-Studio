import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Exercise the exact engine extension distributed through Yarn, without mounting a Player.
const patch = readFileSync(path.resolve(".yarn/patches/narraleaf-react-npm-1.5.0-frame-sequence.patch"), "utf8");
const source = patch
    .split("+++ b/dist/frame-sequence.js\n")[1]
    // The patch carries other files after this one; their lines are not part of the module.
    .split("\ndiff --git ")[0]
    .split("\n")
    .filter(line => line.startsWith("+"))
    .map(line => line.slice(1))
    .join("\n")
    .replace('import { useLayoutEffect } from "react";', "")
    .replace(/export function /g, "function ");
const createResolver = () =>
    new Function(`${source}; return resolveFrameSequence;`)() as (
        src: string,
        image: { state: Record<string, unknown> },
    ) => string;
const key = (id = "idle", loop = true) =>
    `a.png#nls-sequence=${encodeURIComponent(JSON.stringify({ id, frames: ["a.png", "b.png", "c.png"], fps: 10, loop }))}`;

describe("packaged sequence frame resolver", () => {
    it("samples restored time and gives transition copies the same frame", () => {
        const resolve = createResolver();
        const image = { state: { frameSequencePlayback: { activeId: "idle", clips: { idle: { elapsedMs: 245 } } } } };
        expect(resolve(key(), image)).toBe("c.png");
        expect(resolve(key(), image)).toBe("c.png");
        expect(image.state.frameSequencePlayback.clips.idle.elapsedMs).toBe(245);
    });

    it("wraps looping frames, holds non-looping frames, and leaves static images untouched", () => {
        const resolve = createResolver();
        const image = { state: { frameSequencePlayback: { activeId: "idle", clips: { idle: { elapsedMs: 400 } } } } };
        expect(resolve(key(), image)).toBe("b.png");
        expect(resolve(key("idle", false), image)).toBe("c.png");
        expect(resolve("static.png", image)).toBe("static.png");
        expect(resolve("static.png#nls-sequence=broken", image)).toBe("static.png#nls-sequence=broken");
    });

    it("keeps separate instance state", () => {
        const resolve = createResolver();
        const first = { state: { frameSequencePlayback: { activeId: "idle", clips: { idle: { elapsedMs: 200 } } } } };
        const second = { state: {} };
        expect(resolve(key(), first)).toBe("c.png");
        expect(resolve(key(), second)).toBe("a.png");
    });
});
