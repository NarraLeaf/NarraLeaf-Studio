import { describe, expect, it } from "vitest";
import { AgentActivityLog, agentActivityToJsonl, filterAgentActivity } from "./AgentActivityLog";

/**
 * The Agent log's memory: a bounded ring that keeps the newest calls, a running row that its end
 * fills in, the three filters the panel offers, and an export that holds nothing a row does not.
 */

function clock() {
    let now = 1_700_000_000_000;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("AgentActivityLog", () => {
    it("keeps only the newest entries once full", () => {
        const log = new AgentActivityLog(3);
        for (let index = 0; index < 5; index += 1) {
            log.record(`tool_${index}`, null, "workspace", { ok: true, durationMs: 1 });
        }
        expect(log.getEntries().map(entry => entry.tool)).toEqual(["tool_2", "tool_3", "tool_4"]);
    });

    it("shows a running call and fills it in when it ends", () => {
        const time = clock();
        const log = new AgentActivityLog(500, time.now);
        const id = log.begin("ui_patch", "Claude Code");
        expect(log.getEntries()[0]).toMatchObject({ tool: "ui_patch", status: "running", write: true, durationMs: null });
        time.advance(42);
        log.end(id, {
            ok: true,
            durationMs: 42,
            target: "Title",
            reveal: { kind: "surface", surfaceId: "s1", name: "Title", elementIds: ["e1"] },
        });
        expect(log.getEntries()[0]).toMatchObject({ status: "ok", durationMs: 42, target: "Title", reveal: { surfaceId: "s1" } });
    });

    it("lets go of an end whose row was already pushed out", () => {
        const log = new AgentActivityLog(1);
        const first = log.begin("ui_show", null);
        log.record("lint", null, "workspace", { ok: true, durationMs: 1 });
        log.end(first, { ok: true, durationMs: 5 });
        expect(log.getEntries().map(entry => entry.tool)).toEqual(["lint"]);
    });

    it("never records main's internal calls", () => {
        const log = new AgentActivityLog();
        expect(log.begin("__state", null)).toBe(-1);
        log.record("__build", null, "workspace", { ok: true, durationMs: 1 });
        expect(log.getEntries()).toHaveLength(0);
    });

    it("records what main reports, with the summary as the target", () => {
        const log = new AgentActivityLog();
        log.recordMain({ tool: "build", clientName: "opencode", ok: false, code: "untrusted", message: "Not trusted", durationMs: 3, summary: "web" });
        expect(log.getEntries()[0]).toMatchObject({ side: "main", status: "refused", code: "untrusted", target: "web", write: true });
    });

    it("tells subscribers about every change and nothing after they leave", () => {
        const log = new AgentActivityLog();
        let calls = 0;
        const leave = log.subscribe(() => {
            calls += 1;
        });
        const before = log.getEntries();
        const id = log.begin("lint", null);
        log.end(id, { ok: true, durationMs: 1 });
        expect(calls).toBe(2);
        expect(log.getEntries()).not.toBe(before);
        leave();
        log.clear();
        expect(calls).toBe(2);
        expect(log.getEntries()).toHaveLength(0);
    });
});

describe("the Agent log's filters and export", () => {
    const log = new AgentActivityLog();
    log.record("ui_show", "A", "workspace", { ok: true, durationMs: 1 });
    log.record("ui_patch", "A", "workspace", { ok: true, durationMs: 2, target: "Title" });
    log.record("story_apply", "A", "workspace", { ok: false, code: "stale_revision", message: "Read it again", hint: "Call story_show", durationMs: 3 });
    log.record("ui_screenshot", "A", "workspace", { ok: false, code: "not_found", message: "No page", durationMs: 4 });
    const entries = log.getEntries();

    it("narrows to changes and to failures", () => {
        expect(filterAgentActivity(entries, "all")).toHaveLength(4);
        expect(filterAgentActivity(entries, "writes").map(entry => entry.tool)).toEqual(["ui_patch", "story_apply"]);
        expect(filterAgentActivity(entries, "failures").map(entry => entry.tool)).toEqual(["story_apply", "ui_screenshot"]);
    });

    it("exports one JSON object per line with only the row's fields", () => {
        const lines = agentActivityToJsonl(entries).trim().split("\n").map(line => JSON.parse(line));
        expect(lines).toHaveLength(4);
        expect(lines[2]).toMatchObject({ tool: "story_apply", status: "refused", code: "stale_revision", hint: "Call story_show", durationMs: 3 });
        expect(Object.keys(lines[1]).sort()).toEqual(["client", "durationMs", "side", "status", "target", "time", "tool", "write"]);
        expect(agentActivityToJsonl([])).toBe("");
    });
});
