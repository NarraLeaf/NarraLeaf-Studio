import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { buildStoryCommandManual, filterStoryCommandManual } from "./storyCommandManualModel";

// A stub translate: echoes the key. The signature's positional slots read a param hint through it, so
// they show the key here — the structural shape (delimiters, named slots, order) is what these pin.
const t = (key: TranslationKey) => key as string;

function entry(id: string) {
    const found = buildStoryCommandManual(t).find(candidate => candidate.id === id);
    if (!found) {
        throw new Error(`manual entry missing: ${id}`);
    }
    return found;
}

describe("buildStoryCommandManual", () => {
    it("derives the token and slash-spelled aliases from the spec", () => {
        const bg = entry("background");
        expect(bg.token).toBe("/bg");
        expect(bg.aliases).toEqual(["/background"]);
    });

    it("wraps a required-core positional in <…> and a named optional in [key=]", () => {
        const bg = entry("background");
        // `/bg <…image hint…> [t=] [d=]` — core image first, named modifiers after.
        expect(bg.signature.startsWith("/bg <")).toBe(true);
        expect(bg.signature).toContain("[t=]");
        expect(bg.signature).toContain("[d=]");
    });

    it("marks a greedy value with a trailing ellipsis", () => {
        // `/set <variable> <expression…>` — the expression eats the rest of the line.
        expect(entry("set").signature).toContain("…");
    });

    it("covers every registered command", () => {
        expect(buildStoryCommandManual(t).length).toBeGreaterThan(30);
    });
});

describe("filterStoryCommandManual", () => {
    const all = buildStoryCommandManual(t);

    it("returns everything for an empty query", () => {
        expect(filterStoryCommandManual(all, "")).toHaveLength(all.length);
    });

    it("finds a command by its token", () => {
        expect(filterStoryCommandManual(all, "bg").map(command => command.id)).toContain("background");
    });

    it("finds a zh-labelled command by pinyin", () => {
        expect(filterStoryCommandManual(all, "beijing").map(command => command.id)).toContain("background");
    });
});
