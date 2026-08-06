import { describe, expect, it } from "vitest";
import type { LintLocation, LintReportEntry, LintRuleId, LintSeverity } from "@/lib/lint";
import { isFreezeExemptCommand } from "../../components/ui/freezeActionPolicy";
import { LINT_PROJECT_COMMAND_ID } from "./lintIds";
import {
    filterLintEntries,
    flattenLintGroups,
    groupLintEntries,
    lintEntryExcerpt,
    lintEntryLocator,
    lintLocationKey,
    lintLocationLabel,
    lintRuleDescriptionKey,
    lintRuleTitleKey,
    lintSeverityLabelKey,
    type LintGroupLabels,
} from "./lintReportModel";

const labels: LintGroupLabels = {
    ruleTitle: ruleId => `title:${ruleId}`,
    locationLabel: location => lintLocationLabel(location, "My Game"),
};

function entry(
    ruleId: LintRuleId,
    severity: LintSeverity,
    location: LintLocation,
    target?: LintReportEntry["target"],
): LintReportEntry {
    return {
        ruleId,
        severity,
        location,
        target,
        messageKey: "lint.message.ruleFailed",
        messageParams: { rule: ruleId },
    };
}

const storyLocation = (sceneId?: string): LintLocation => ({
    kind: "story",
    storyId: "s1",
    storyName: "Chapter One",
    sceneId,
    sceneName: sceneId ? "Opening" : undefined,
});

describe("lintLocationLabel", () => {
    it("files a project-scope finding under the project's own name", () => {
        expect(lintLocationLabel({ kind: "project" }, "My Game")).toBe("My Game");
    });

    it("reads a story location as story / scene, and drops the scene when there is none", () => {
        expect(lintLocationLabel(storyLocation("sc1"), "My Game")).toBe("Chapter One / Opening");
        expect(lintLocationLabel(storyLocation(), "My Game")).toBe("Chapter One");
    });

    it("falls back to the id when a name is missing", () => {
        expect(lintLocationLabel({ kind: "asset", assetId: "a1", assetName: "" }, "")).toBe("a1");
        expect(lintLocationLabel({ kind: "blueprint", blueprintId: "b1" }, "")).toBe("b1");
        expect(lintLocationLabel({ kind: "character", characterId: "c1", characterName: "" }, "")).toBe("c1");
    });
});

describe("lintLocationKey", () => {
    it("groups a scene's findings together, not one group per row", () => {
        const a = { ...storyLocation("sc1"), blockId: "b1" } as LintLocation;
        const b = { ...storyLocation("sc1"), blockId: "b2" } as LintLocation;
        expect(lintLocationKey(a)).toBe(lintLocationKey(b));
    });

    it("keeps two scenes of one story apart", () => {
        expect(lintLocationKey(storyLocation("sc1"))).not.toBe(lintLocationKey(storyLocation("sc2")));
    });

    it("never collides across kinds", () => {
        const keys = [
            lintLocationKey({ kind: "project" }),
            lintLocationKey({ kind: "asset", assetId: "x", assetName: "x" }),
            lintLocationKey(storyLocation("x")),
            lintLocationKey({ kind: "blueprint", blueprintId: "x" }),
            lintLocationKey({ kind: "character", characterId: "x", characterName: "x" }),
        ];
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("lintEntryLocator", () => {
    const row = (line?: number, excerpt?: string): LintLocation => ({
        kind: "story",
        storyId: "s1",
        storyName: "Chapter One",
        sceneId: "sc1",
        sceneName: "Opening",
        blockId: "b1",
        line,
        excerpt,
    });

    it("grouped by rule, names the place and the row - the heading only named the rule", () => {
        expect(lintEntryLocator(row(12), "rule", labels.locationLabel, "Jumps to ending")).toEqual({
            label: "Chapter One / Opening",
            line: 12,
        });
    });

    it("grouped by location, names only the row - the heading already named the place", () => {
        expect(lintEntryLocator(row(12), "location", labels.locationLabel, "Jumps to ending")).toEqual({ label: "", line: 12 });
    });

    it("has no row number for a finding that is about a whole scene, or about no scene at all", () => {
        expect(lintEntryLocator(row(undefined), "rule", labels.locationLabel, "x").line).toBeNull();
        expect(lintEntryLocator({ kind: "project" }, "location", labels.locationLabel, "x")).toEqual({
            label: "",
            line: null,
        });
    });

    it("says nothing the message already said", () => {
        // `assets/unused` names its subject inside the sentence, so a locator beside it stutters.
        const asset: LintLocation = { kind: "asset", assetId: "a1", assetName: "dialog.png" };
        expect(lintEntryLocator(asset, "rule", labels.locationLabel, "dialog.png is not used anywhere"))
            .toEqual({ label: "", line: null });
        // Only the repeated half goes: the story name is still the reader's only way to that story.
        expect(lintEntryLocator(row(12), "rule", labels.locationLabel, "Opening references a missing asset"))
            .toEqual({ label: "Chapter One", line: 12 });
    });

    it("hands out the row's own words, and nothing for a location that has none", () => {
        expect(lintEntryExcerpt(row(12, "It rained all week."))).toBe("It rained all week.");
        expect(lintEntryExcerpt(row(12))).toBe("");
        expect(lintEntryExcerpt({ kind: "asset", assetId: "a1", assetName: "bg.png" })).toBe("");
    });
});

describe("i18n keys", () => {
    it("derives the rule title key from the rule id", () => {
        expect(lintRuleTitleKey("assets/unused")).toBe("lint.rule.assetsUnused.title");
        expect(lintRuleTitleKey("story/goto-missing")).toBe("lint.rule.storyGotoMissing.title");
    });

    it("derives the rule description key from the rule id", () => {
        expect(lintRuleDescriptionKey("story/dead-end")).toBe("lint.rule.storyDeadEnd.description");
    });

    it("names the three severities", () => {
        expect(lintSeverityLabelKey("error")).toBe("lint.severity.error");
        expect(lintSeverityLabelKey("info")).toBe("lint.severity.info");
    });
});

describe("filterLintEntries", () => {
    const entries = [
        entry("assets/unused", "warning", { kind: "project" }),
        entry("story/goto-missing", "error", storyLocation("sc1")),
        entry("story/empty-scene", "info", storyLocation("sc2")),
    ];

    it("passes everything through on 'all', as a copy", () => {
        const all = filterLintEntries(entries, "all");
        expect(all).toHaveLength(3);
        expect(all).not.toBe(entries);
    });

    it("keeps only the chosen severity", () => {
        expect(filterLintEntries(entries, "error").map(e => e.ruleId)).toEqual(["story/goto-missing"]);
        expect(filterLintEntries(entries, "info")).toHaveLength(1);
    });
});

describe("groupLintEntries", () => {
    const entries = [
        entry("story/empty-scene", "info", storyLocation("sc1")),
        entry("assets/unused", "warning", { kind: "asset", assetId: "a1", assetName: "bg.png" }),
        entry("story/goto-missing", "error", storyLocation("sc1")),
        entry("story/goto-missing", "error", storyLocation("sc2")),
    ];

    it("buckets by rule and sorts worst severity first", () => {
        const groups = groupLintEntries(entries, "rule", labels);
        expect(groups.map(g => g.key)).toEqual(["story/goto-missing", "assets/unused", "story/empty-scene"]);
        expect(groups[0].entries).toHaveLength(2);
        expect(groups[0].title).toBe("title:story/goto-missing");
    });

    it("buckets by location, taking the worst severity in the bucket", () => {
        const groups = groupLintEntries(entries, "location", labels);
        // sc1 holds an info and an error, so the group is an error group and sorts first.
        expect(groups[0].key).toBe(lintLocationKey(storyLocation("sc1")));
        expect(groups[0].severity).toBe("error");
        expect(groups[0].entries).toHaveLength(2);
        expect(groups[0].title).toBe("Chapter One / Opening");
    });

    it("puts a location's findings back into row order, scene-wide ones first", () => {
        const at = (line?: number): LintLocation => ({
            kind: "story",
            storyId: "s1",
            storyName: "Chapter One",
            sceneId: "sc1",
            sceneName: "Opening",
            ...(line === undefined ? {} : { blockId: `b${line}`, line }),
        });
        const groups = groupLintEntries(
            [
                entry("story/goto-missing", "error", at(12)),
                entry("text/empty", "info", at(4)),
                entry("story/empty-scene", "info", at()),
                entry("text/overlong", "warning", at(9)),
            ],
            "location",
            labels,
        );
        expect(groups[0].entries.map(e => (e.location.kind === "story" ? e.location.line : null)))
            .toEqual([undefined, 4, 9, 12]);
    });

    it("keeps the report's own order inside a group", () => {
        const groups = groupLintEntries(entries, "rule", labels);
        const gotoGroup = groups.find(g => g.key === "story/goto-missing")!;
        expect(gotoGroup.entries.map(e => e.location.kind === "story" && e.location.sceneId)).toEqual(["sc1", "sc2"]);
    });

    it("returns nothing for no entries", () => {
        expect(groupLintEntries([], "rule", labels)).toEqual([]);
    });

    it("flags a group whose entries do not all share one severity", () => {
        // By rule this is the exception (severity is resolved per rule) and it is what lets the rows
        // drop the severity word; by location it is the norm.
        const byRule = groupLintEntries(entries, "rule", labels);
        expect(byRule.every(group => !group.mixedSeverity)).toBe(true);

        const mixed = groupLintEntries(
            [
                entry("story/goto-missing", "error", storyLocation("sc1")),
                entry("story/goto-missing", "warning", storyLocation("sc1")),
            ],
            "rule",
            labels,
        );
        expect(mixed[0].mixedSeverity).toBe(true);
        expect(groupLintEntries(entries, "location", labels)[0].mixedSeverity).toBe(true);
    });
});

describe("flattenLintGroups", () => {
    it("emits one heading row per group followed by its entries, with unique keys", () => {
        const groups = groupLintEntries(
            [
                entry("story/goto-missing", "error", storyLocation("sc1")),
                entry("story/goto-missing", "error", storyLocation("sc2")),
                entry("assets/unused", "warning", { kind: "project" }),
            ],
            "rule",
            labels,
        );
        const rows = flattenLintGroups(groups);

        expect(rows.map(row => row.kind)).toEqual(["group", "entry", "entry", "group", "entry"]);
        expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    });

    it("keeps a collapsed group's heading and drops its entries", () => {
        const groups = groupLintEntries(
            [
                entry("story/goto-missing", "error", storyLocation("sc1")),
                entry("story/goto-missing", "error", storyLocation("sc2")),
                entry("assets/unused", "warning", { kind: "project" }),
            ],
            "rule",
            labels,
        );
        const rows = flattenLintGroups(groups, new Set(["story/goto-missing"]));

        expect(rows.map(row => row.kind)).toEqual(["group", "group", "entry"]);
        // The heading still counts what it is hiding, so folding never loses the number.
        expect(rows[0].group.entries).toHaveLength(2);
    });
});

describe("freeze exemption", () => {
    it("keeps the project sweep runnable while the workspace is frozen", () => {
        // Ruling R3: a read-only sweep is exactly what an author wants on a frozen revision.
        expect(isFreezeExemptCommand(LINT_PROJECT_COMMAND_ID)).toBe(true);
        expect(isFreezeExemptCommand("some-plugin:lint:project")).toBe(false);
    });
});
