import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import {
    applyRetention,
    extractRowVersions,
    hashString,
    sceneWithRowRestored,
    type SceneHistoryEntryMeta,
} from "./sceneHistoryModel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 10, 12, 12, 0, 0).getTime();

function entry(id: string, kind: "auto" | "manual", createdAt: number): SceneHistoryEntryMeta {
    return { id, kind, createdAt, hash: "0", blockCount: 1 };
}

function narration(id: string, text: string): StoryBlock {
    return {
        id, kind: "nodeAction", parentId: null, childrenIds: [],
        payload: { action: "narration", text: { value: text, runs: [] } },
    } as unknown as StoryBlock;
}

function sceneWith(...blocks: StoryBlock[]): StoryScene {
    return {
        id: "s1", name: "S", runtimeName: "s", rootBlockIds: blocks.map(b => b.id),
        blocks: Object.fromEntries(blocks.map(b => [b.id, b])),
    } as StoryScene;
}

describe("applyRetention", () => {
    it("keeps the newest N automatic snapshots and every manual one", () => {
        const entries = [
            entry("m", "manual", BASE - 100 * DAY),
            ...Array.from({ length: 5 }, (_, i) => entry(`a${i}`, "auto", BASE - i * 10 * 60_000)),
        ];
        const { keep, drop } = applyRetention(entries, { keepRecent: 3, keepDaily: 0, maxAuto: 10 });
        expect(keep.map(e => e.id).sort()).toEqual(["a0", "a1", "a2", "m"]);
        expect(drop.map(e => e.id).sort()).toEqual(["a3", "a4"]);
    });

    it("keeps the newest snapshot of each day beyond the recent window", () => {
        const entries = [
            entry("today", "auto", BASE),
            entry("y-late", "auto", BASE - DAY + HOUR),
            entry("y-early", "auto", BASE - DAY - HOUR),
            entry("old", "auto", BASE - 3 * DAY),
        ];
        const { keep } = applyRetention(entries, { keepRecent: 1, keepDaily: 2, maxAuto: 10 });
        expect(keep.map(e => e.id).sort()).toEqual(["today", "y-late"]);
    });

    it("caps automatic snapshots at maxAuto, newest first", () => {
        const entries = Array.from({ length: 6 }, (_, i) => entry(`a${i}`, "auto", BASE - i * DAY));
        const { keep } = applyRetention(entries, { keepRecent: 6, keepDaily: 6, maxAuto: 2 });
        expect(keep.map(e => e.id)).toEqual(["a0", "a1"]);
    });
});

describe("extractRowVersions", () => {
    const snap = (id: string, at: number, scene: StoryScene | null) => ({
        source: { kind: "snapshot" as const, entry: entry(id, "auto", at) }, at, scene,
    });

    it("lists distinct versions newest first, dropping the current one and repeats", () => {
        const current = narration("b", "three");
        const versions = extractRowVersions("b", current, [
            snap("1", 1, sceneWith(narration("b", "one"))),
            snap("2", 2, sceneWith(narration("b", "two"))),
            snap("3", 3, sceneWith(narration("b", "two"))),
            snap("4", 4, sceneWith(narration("b", "three"))),
        ]);
        expect(versions.map(v => v.source.kind === "snapshot" && v.source.entry.id)).toEqual(["3", "1"]);
    });

    it("reports a source that has the scene but not the row as an absent version, and skips sources without the scene", () => {
        const versions = extractRowVersions("b", narration("b", "x"), [
            snap("1", 1, sceneWith(narration("other", "y"))),
            snap("2", 2, null),
        ]);
        expect(versions).toHaveLength(1);
        expect(versions[0].block).toBeNull();
    });
});

describe("sceneWithRowRestored", () => {
    it("replaces content but keeps the row's place, without touching the input scene", () => {
        const scene = sceneWith(narration("b", "now"));
        const restored = sceneWithRowRestored(scene, narration("b", "then"))!;
        expect((restored.blocks.b.payload as { text: { value: string } }).text.value).toBe("then");
        expect((scene.blocks.b.payload as { text: { value: string } }).text.value).toBe("now");
        expect(restored.rootBlockIds).toEqual(["b"]);
    });

    it("refuses a row that no longer exists", () => {
        expect(sceneWithRowRestored(sceneWith(), narration("b", "then"))).toBeNull();
    });
});

describe("hashString", () => {
    it("is stable and distinguishes small changes", () => {
        expect(hashString("abc")).toBe(hashString("abc"));
        expect(hashString("abc")).not.toBe(hashString("abd"));
    });
});
