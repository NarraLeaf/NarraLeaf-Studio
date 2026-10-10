import { describe, expect, it } from "vitest";
import type { LintSeverity } from "@/lib/lint/types";
import { countLintRules, describeLintPage, matchesLintRule, pageLintEntries } from "./lintPage";

type Entry = { severity: LintSeverity; ruleId: string; n: number };

/** 500 unused assets reported first, the way a skeleton project's sweep comes back, then the rest. */
function floodedReport(): Entry[] {
    const entries: Entry[] = [];
    for (let n = 0; n < 500; n += 1) {
        entries.push({ severity: "warning", ruleId: "assets/unused", n });
    }
    entries.push({ severity: "warning", ruleId: "story/background-unchanged", n: 500 });
    entries.push({ severity: "error", ruleId: "story/dead-end", n: 501 });
    entries.push({ severity: "info", ruleId: "variables/unused", n: 502 });
    entries.push({ severity: "error", ruleId: "story/goto-missing", n: 503 });
    return entries;
}

const counts = { error: 2, warning: 501, info: 1 };

describe("lint paging", () => {
    it("counts every rule over the whole report, most severe and then most numerous first", () => {
        expect(countLintRules(floodedReport())).toEqual([
            { rule: "story/dead-end", severity: "error", count: 1 },
            { rule: "story/goto-missing", severity: "error", count: 1 },
            { rule: "assets/unused", severity: "warning", count: 500 },
            { rule: "story/background-unchanged", severity: "warning", count: 1 },
            { rule: "variables/unused", severity: "info", count: 1 },
        ]);
    });

    it("takes a rule's most severe finding as its severity", () => {
        expect(countLintRules([
            { severity: "warning", ruleId: "story/dead-end" },
            { severity: "error", ruleId: "story/dead-end" },
        ])).toEqual([{ rule: "story/dead-end", severity: "error", count: 2 }]);
    });

    it("pages past the first 150 with a cursor until nothing remains", () => {
        const entries = floodedReport();
        const request = { threshold: "warning" as const, offset: 0, limit: 150 };
        const first = pageLintEntries(entries, request);
        expect(first.matched).toBe(503);
        expect(first.page).toHaveLength(150);
        // Errors first, then the report's own order.
        expect(first.page.slice(0, 2).map(entry => entry.ruleId)).toEqual(["story/dead-end", "story/goto-missing"]);
        expect(first.nextCursor).toBe("150");

        const seen = [...first.page];
        let cursor = first.nextCursor;
        while (cursor) {
            const next = pageLintEntries(entries, { ...request, offset: Number(cursor) });
            seen.push(...next.page);
            cursor = next.nextCursor;
        }
        expect(seen).toHaveLength(503);
        expect(new Set(seen.map(entry => entry.n)).size).toBe(503);
        // The one warning written after the flood is reachable at last.
        expect(seen.at(-1)?.ruleId).toBe("story/background-unchanged");
    });

    it("filters by an exact rule id or a category prefix, and counts the whole report regardless", () => {
        const entries = floodedReport();
        const exact = pageLintEntries(entries, { threshold: "info", rule: "story/dead-end", offset: 0, limit: 150 });
        expect(exact.page.map(entry => entry.n)).toEqual([501]);
        expect(exact.matched).toBe(1);
        expect(exact.nextCursor).toBeNull();
        expect(exact.byRule).toHaveLength(5);

        const prefix = pageLintEntries(entries, { threshold: "info", rule: "story/", offset: 0, limit: 150 });
        expect(prefix.page.map(entry => entry.ruleId)).toEqual([
            "story/dead-end",
            "story/goto-missing",
            "story/background-unchanged",
        ]);
    });

    it("reads a rule without a trailing slash as an exact id, never as a prefix", () => {
        expect(matchesLintRule("story/dead-end", "story")).toBe(false);
        expect(matchesLintRule("story/dead-end", "story/")).toBe(true);
        expect(matchesLintRule("story/dead-end", "story/dead")).toBe(false);
        expect(matchesLintRule("story/dead-end", undefined)).toBe(true);
    });

    it("leads with the totals, the per-rule counts and how to get the next page", () => {
        const request = { threshold: "warning" as const, offset: 150, limit: 150 };
        const page = pageLintEntries(floodedReport(), request);
        const lead = describeLintPage(counts, { ...page, shown: page.page.length }, request);
        expect(lead.split("\n")).toEqual([
            "2 error(s), 501 warning(s), 1 info.",
            "By rule: story/dead-end 1 (error), story/goto-missing 1 (error), assets/unused 500 (warning), "
                + "story/background-unchanged 1 (warning), variables/unused 1 (info).",
            "503 finding(s) matching severity warning or worse; showing 151-300. "
                + "For the next page, call lint again with cursor \"300\" and the same filters.",
            "Fix every error before building.",
        ]);
    });

    it("says so when a filter matches nothing, rather than printing an empty page", () => {
        const request = { threshold: "info" as const, rule: "ui/", offset: 0, limit: 150 };
        const page = pageLintEntries(floodedReport(), request);
        const lead = describeLintPage(counts, { ...page, shown: 0 }, request);
        expect(lead).toContain("No finding matching rule ui/.");
    });
});
