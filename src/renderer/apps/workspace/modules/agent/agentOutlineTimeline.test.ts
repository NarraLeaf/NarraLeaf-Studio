import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWriteTarget } from "@/lib/workspace/services/agent/AgentFollowService";
import {
    AGENT_OUTLINE_FADE_MS,
    AGENT_OUTLINE_PENDING_MS,
    AGENT_OUTLINE_VISIBLE_MS,
    AgentOutlineTimeline,
    agentWritePlaceKey,
    type AgentHighlightRect,
    type AgentOutline,
} from "./agentOutlineTimeline";

/**
 * Follow mode's outline is there so the author can see what the agent did, glancing over: it stays
 * until the next write lands elsewhere or a few seconds pass, then fades; the author's own click or
 * keystroke takes it away at once.
 */

const ROW: AgentHighlightRect = { left: 10, top: 20, width: 300, height: 24 };

function scene(blockIds: string[], sceneId = "scene-1"): AgentWriteTarget {
    return { kind: "scene", storyId: "story", sceneId, name: "走廊", blockIds };
}

function harness() {
    let latest: readonly AgentOutline[] = [];
    const timeline = new AgentOutlineTimeline(outlines => {
        latest = outlines;
    });
    // Everything is on screen unless a test says otherwise.
    let onScreen = true;
    const measure = () => timeline.measure(() => (onScreen ? [ROW] : []));
    return {
        timeline,
        measure,
        hide: () => {
            onScreen = false;
        },
        show: () => {
            onScreen = true;
        },
        phases: () => latest.map(outline => outline.phase),
        drawn: () => latest.filter(outline => outline.rects.length > 0).map(outline => `${outline.key}:${outline.phase}`),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("follow mode's outline", () => {
    it("stays for the visible time once on screen, then fades and goes", () => {
        const h = harness();
        h.timeline.add(scene(["a"]));
        expect(h.phases()).toEqual(["pending"]);
        h.measure();
        expect(h.phases()).toEqual(["shown"]);

        vi.advanceTimersByTime(AGENT_OUTLINE_VISIBLE_MS - 1);
        expect(h.phases()).toEqual(["shown"]);
        vi.advanceTimersByTime(1);
        expect(h.phases()).toEqual(["leaving"]);
        vi.advanceTimersByTime(AGENT_OUTLINE_FADE_MS);
        expect(h.phases()).toEqual([]);
    });

    it("starts its time when it is first seen, not when the write landed", () => {
        const h = harness();
        h.hide();
        h.timeline.add(scene(["a"]));
        h.measure();
        // The tab is still opening.
        vi.advanceTimersByTime(AGENT_OUTLINE_PENDING_MS - 100);
        expect(h.phases()).toEqual(["pending"]);
        h.show();
        h.measure();
        vi.advanceTimersByTime(AGENT_OUTLINE_VISIBLE_MS - 1);
        expect(h.phases()).toEqual(["shown"]);
    });

    it("is given up when what it outlines never shows", () => {
        const h = harness();
        h.hide();
        h.timeline.add(scene(["a"]));
        vi.advanceTimersByTime(AGENT_OUTLINE_PENDING_MS);
        expect(h.phases()).toEqual([]);
    });

    it("fades as soon as the next write lands elsewhere, and outlines that one", () => {
        const h = harness();
        h.timeline.add(scene(["a"]));
        h.measure();
        vi.advanceTimersByTime(1000);
        h.timeline.add(scene(["b"]));
        h.measure();
        expect(h.drawn()).toEqual([`${agentWritePlaceKey(scene(["a"]))}:leaving`, `${agentWritePlaceKey(scene(["b"]))}:shown`]);
        vi.advanceTimersByTime(AGENT_OUTLINE_FADE_MS);
        expect(h.drawn()).toEqual([`${agentWritePlaceKey(scene(["b"]))}:shown`]);
    });

    it("stays, its time started over, when the next write lands on the same rows", () => {
        const h = harness();
        h.timeline.add(scene(["a", "b"]));
        h.measure();
        vi.advanceTimersByTime(3000);
        h.timeline.add(scene(["b", "a"]));
        h.measure();
        expect(h.phases()).toEqual(["shown"]);
        vi.advanceTimersByTime(3000);
        expect(h.phases()).toEqual(["shown"]);
        vi.advanceTimersByTime(AGENT_OUTLINE_VISIBLE_MS - 3000);
        expect(h.phases()).toEqual(["leaving"]);
    });

    it("ends when a write with nothing to outline lands somewhere else", () => {
        const h = harness();
        h.timeline.add(scene(["a"]));
        h.measure();
        h.timeline.add({ kind: "blueprint", blueprintId: "bp", name: "Start" });
        expect(h.phases()).toEqual(["leaving"]);
        vi.advanceTimersByTime(AGENT_OUTLINE_FADE_MS);
        expect(h.phases()).toEqual([]);
    });

    it("goes at once, without a fade, when the author clicks or types", () => {
        const h = harness();
        h.timeline.add(scene(["a"]));
        h.measure();
        h.timeline.add(scene(["b"]));
        h.measure();
        h.timeline.clear();
        expect(h.phases()).toEqual([]);
        // Nothing left to come back.
        vi.advanceTimersByTime(AGENT_OUTLINE_VISIBLE_MS + AGENT_OUTLINE_FADE_MS);
        expect(h.phases()).toEqual([]);
    });

    it("follows what it outlines, and is not drawn while that is out of sight", () => {
        const h = harness();
        h.timeline.add(scene(["a"]));
        h.measure();
        expect(h.drawn()).toHaveLength(1);
        h.hide();
        h.measure();
        expect(h.drawn()).toEqual([]);
        expect(h.phases()).toEqual(["shown"]);
        h.show();
        h.measure();
        expect(h.drawn()).toHaveLength(1);
    });
});
