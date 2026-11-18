import { EventEmitter } from "events";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchSubtree } from "./subtreeWatcher";

const fs = vi.hoisted(() => ({
    watch: vi.fn(),
    statSync: vi.fn(),
    stat: vi.fn(),
    clock: vi.fn(),
}));

vi.mock("../../../utils/unpatchedFs", () => ({
    unpatchedFs: { watch: fs.watch, statSync: fs.statSync },
    unpatchedFsPromises: { stat: fs.stat },
}));
vi.mock("node:perf_hooks", () => ({ performance: { timeOrigin: 1000, now: fs.clock } }));

const root = path.join(path.sep, "project", "content");
const missingChild = path.join(root, "content");
const rootStats = (mtimeMs: number) => ({ dev: 1, ino: 2, mtimeMs, ctimeMs: mtimeMs });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe("watchSubtree root events", () => {
    let events: EventEmitter;
    let currentRoot: ReturnType<typeof rootStats>;
    let changed: string[];

    beforeEach(() => {
        events = new EventEmitter();
        currentRoot = rootStats(100);
        changed = [];
        fs.watch.mockReset().mockReturnValue(events);
        fs.statSync.mockReset().mockImplementation(() => currentRoot);
        fs.clock.mockReset().mockReturnValue(0.8);
        fs.stat.mockReset().mockImplementation(async (file: string) => {
            if (file === root) return currentRoot;
            throw new Error("ENOENT");
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it("ignores a root rename event when the root is unchanged", async () => {
        watchSubtree(root, new Map(), file => changed.push(file));

        events.emit("change", "rename", path.basename(root));
        await flush();

        expect(changed).toEqual([]);
    });

    it("reports a deleted child with the same name as the root", async () => {
        watchSubtree(root, new Map(), file => changed.push(file));
        currentRoot = rootStats(101);

        events.emit("change", "rename", path.basename(root));
        await flush();

        expect(changed).toEqual([missingChild]);
    });

    it("reports another deleted child even when the root cannot be compared", async () => {
        watchSubtree(root, new Map(), file => changed.push(file));

        events.emit("change", "rename", "other");
        await flush();

        expect(changed).toEqual([path.join(root, "other")]);
    });

    it("ignores an older file written in the same millisecond, then reports its next write", async () => {
        vi.spyOn(Date, "now").mockReturnValue(1000);
        let fileMtime = 1000.3;
        fs.stat.mockImplementation(async (file: string) => file === root
            ? currentRoot
            : { mtimeMs: fileMtime, size: 1, isFile: () => true });
        watchSubtree(root, new Map(), file => changed.push(file));

        events.emit("change", "rename", "bg.png");
        await flush();
        expect(changed).toEqual([]);

        fileMtime = 1000.9;
        events.emit("change", "change", "bg.png");
        await flush();
        expect(changed).toEqual([path.join(root, "bg.png")]);
    });

    it("uses the wall clock if the process clock has drifted", async () => {
        vi.spyOn(Date, "now").mockReturnValue(1000);
        fs.clock.mockReturnValue(3000);
        fs.stat.mockResolvedValue({ mtimeMs: 1001, size: 1, isFile: () => true });
        watchSubtree(root, new Map(), file => changed.push(file));

        events.emit("change", "change", "bg.png");
        await flush();

        expect(changed).toEqual([path.join(root, "bg.png")]);
    });
});
