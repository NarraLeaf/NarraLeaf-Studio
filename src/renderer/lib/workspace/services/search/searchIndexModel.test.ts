import { describe, expect, it } from "vitest";
import {
    indexEntries,
    parseSearchQuery,
    querySearchIndex,
    type SearchIndexEntry,
} from "./searchIndexModel";
import { compileMatcher, type TextMatchOptions } from "./textMatcher";

/**
 * The pure query model only. Extraction is per source and tested next to each descriptor under
 * `sources/`; the machinery that drives them is tested in `SearchService.test.ts`.
 */

describe("parseSearchQuery", () => {
    it("lowercases terms and splits on whitespace", () => {
        expect(parseSearchQuery("Good MORNING").terms).toEqual(["good", "morning"]);
    });

    it("keeps a quoted phrase as one term", () => {
        expect(parseSearchQuery('"good morning" inko').terms).toEqual(["good morning", "inko"]);
    });

    it("pulls known key:value pairs out as filters", () => {
        const parsed = parseSearchQuery("morning type:storyText scene:Opening speaker:Inko");
        expect(parsed.terms).toEqual(["morning"]);
        expect(parsed.filters).toMatchObject({
            groups: ["storyText"],
            sceneName: "opening",
            speaker: "inko",
        });
    });

    it("leaves an unknown prefix as a literal term so URLs stay searchable", () => {
        expect(parseSearchQuery("https://example.com").terms).toEqual(["https://example.com"]);
        expect(parseSearchQuery("nope:value").terms).toEqual(["nope:value"]);
    });

    it("treats an unrecognized group name as a literal term, not a silent empty filter", () => {
        const parsed = parseSearchQuery("type:nonsense");
        expect(parsed.terms).toEqual(["type:nonsense"]);
        expect(parsed.filters.groups).toBeUndefined();
    });

    it("reports the free text as typed, minus the facets, for the matcher to compile", () => {
        expect(parseSearchQuery("Good MORNING").text).toBe("Good MORNING");
        expect(parseSearchQuery("Morning scene:Opening speaker:Inko").text).toBe("Morning");
        expect(parseSearchQuery('"good morning"').text).toBe("good morning");
        // A prefix that is not a facet stays part of the text, same as it stays a term.
        expect(parseSearchQuery("type:nonsense").text).toBe("type:nonsense");
    });
});

describe("querySearchIndex", () => {
    const entries = indexEntries([
        { id: "1", group: "storyText", text: "Good morning, Inko!", detail: "Main Story › Opening", fields: { sceneName: "Opening", speaker: "Inko" }, target: { kind: "localizationKey", keyName: "x" } },
        { id: "2", group: "storyText", text: "It is a fine morning.", detail: "Main Story › Opening", fields: { sceneName: "Opening" }, target: { kind: "localizationKey", keyName: "x" } },
        { id: "3", group: "variable", text: "MorningFlag", target: { kind: "localizationKey", keyName: "x" } },
        { id: "4", group: "uiTextKey", text: "menu.start", detail: "Start the morning", target: { kind: "localizationKey", keyName: "x" } },
        { id: "5", group: "asset", text: "bgm-dawn.ogg", aux: "morning theme", fields: { assetType: "audio" }, target: { kind: "localizationKey", keyName: "x" } },
    ] satisfies SearchIndexEntry[]);

    it("returns empty for a blank query", () => {
        expect(querySearchIndex(entries, "   ")).toEqual([]);
    });

    it("matches case-insensitively and reports the highlight range", () => {
        const groups = querySearchIndex(entries, "MORNING");
        const story = groups.find(g => g.group === "storyText");
        expect(story?.hits).toHaveLength(2);
        const hit = story?.hits.find(h => h.entry.id === "1");
        // "morning" in "Good morning, Inko!" starts at index 5
        expect(hit?.titleRanges).toEqual([[5, 12]]);
    });

    it("groups results in the fixed group order", () => {
        const groups = querySearchIndex(entries, "morning");
        // Entities (assets here) lead; content follows.
        expect(groups.map(g => g.group)).toEqual(["asset", "storyText", "variable", "uiTextKey"]);
    });

    it("matches detail at a lower score without a title highlight", () => {
        const groups = querySearchIndex(entries, "morning");
        const keyHit = groups.find(g => g.group === "uiTextKey")?.hits[0];
        expect(keyHit?.titleRanges).toEqual([]);
        expect(keyHit?.matchReason).toBe("detail");
        const titleHit = groups.find(g => g.group === "variable")?.hits[0];
        expect(titleHit && keyHit && titleHit.score > keyHit.score).toBe(true);
    });

    it("matches hidden aux text and says so", () => {
        const asset = querySearchIndex(entries, "morning").find(g => g.group === "asset")?.hits[0];
        expect(asset?.entry.id).toBe("5");
        expect(asset?.matchReason).toBe("aux");
        expect(asset?.titleRanges).toEqual([]);
    });

    it("ranks a word-boundary start above a mid-word occurrence", () => {
        const boundary = querySearchIndex(entries, "morning").find(g => g.group === "storyText");
        // "morning" at word boundary in both; id 2's match is later in the text → lower score
        expect(boundary?.hits[0]?.entry.id).toBe("1");
    });

    it("ANDs terms regardless of word order, across text and detail", () => {
        const forward = querySearchIndex(entries, "good morning");
        const reversed = querySearchIndex(entries, "morning good");
        expect(forward.find(g => g.group === "storyText")?.hits.map(h => h.entry.id)).toEqual(["1"]);
        expect(reversed.find(g => g.group === "storyText")?.hits.map(h => h.entry.id)).toEqual(["1"]);
        // "inko" is in the title, "opening" only in the detail line - both must still match.
        expect(querySearchIndex(entries, "inko opening").find(g => g.group === "storyText")?.hits).toHaveLength(1);
    });

    it("drops an entry when any term is missing", () => {
        expect(querySearchIndex(entries, "morning nonexistent")).toEqual([]);
    });

    it("highlights every matched term in the title", () => {
        const hit = querySearchIndex(entries, "good inko").find(g => g.group === "storyText")?.hits[0];
        expect(hit?.titleRanges).toEqual([[0, 4], [14, 18]]);
    });

    it("honours a quoted phrase as a single term", () => {
        expect(querySearchIndex(entries, '"fine morning"').find(g => g.group === "storyText")?.hits.map(h => h.entry.id))
            .toEqual(["2"]);
        expect(querySearchIndex(entries, '"morning fine"')).toEqual([]);
    });

    it("narrows by a group filter from query syntax", () => {
        const groups = querySearchIndex(entries, "morning type:variable");
        expect(groups.map(g => g.group)).toEqual(["variable"]);
    });

    it("narrows by a field filter from query syntax", () => {
        expect(querySearchIndex(entries, "morning speaker:inko").find(g => g.group === "storyText")?.hits.map(h => h.entry.id))
            .toEqual(["1"]);
        expect(querySearchIndex(entries, "morning speaker:nobody")).toEqual([]);
    });

    it("intersects supplied filters with query-syntax filters", () => {
        const groups = querySearchIndex(entries, "morning type:storyText", { filters: { groups: ["variable"] } });
        expect(groups).toEqual([]);
    });

    it("returns nothing for a facet-only query", () => {
        expect(querySearchIndex(entries, "type:storyText")).toEqual([]);
    });

    it("caps per group and reports the uncapped total", () => {
        const many = indexEntries(
            Array.from({ length: 30 }, (_, i) => ({
                id: `m${i}`,
                group: "storyText" as const,
                text: `morning line ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
        );
        const groups = querySearchIndex(many, "morning", { maxPerGroup: 5 });
        expect(groups[0]?.hits).toHaveLength(5);
        expect(groups[0]?.total).toBe(30);
    });

    it("lifts the cap for an expanded group only", () => {
        const many = indexEntries([
            ...Array.from({ length: 30 }, (_, i) => ({
                id: `s${i}`,
                group: "storyText" as const,
                text: `morning line ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
            ...Array.from({ length: 30 }, (_, i) => ({
                id: `v${i}`,
                group: "variable" as const,
                text: `morning var ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
        ]);
        const groups = querySearchIndex(many, "morning", { maxPerGroup: 5, expandedGroups: ["storyText"] });
        expect(groups.find(g => g.group === "storyText")?.hits).toHaveLength(30);
        expect(groups.find(g => g.group === "variable")?.hits).toHaveLength(5);
    });
});

describe("querySearchIndex with a refined matcher", () => {
    const entries = indexEntries([
        { id: "1", group: "storyText", text: "Good morning, Inko!", detail: "Main Story › Opening", target: { kind: "localizationKey", keyName: "x" } },
        { id: "2", group: "storyText", text: "Good MORNING again.", detail: "Main Story › Opening", target: { kind: "localizationKey", keyName: "x" } },
        { id: "3", group: "storyText", text: "Mornings are fine.", detail: "Main Story › Opening", target: { kind: "localizationKey", keyName: "x" } },
    ]);

    const ids = (query: string, options: Partial<TextMatchOptions>) =>
        querySearchIndex(entries, query, {
            matcher: compileMatcher(query, { caseSensitive: false, wholeWord: false, regex: false, ...options }),
        }).flatMap(group => group.hits.map(hit => hit.entry.id));

    it("applies case sensitivity to the whole query", () => {
        expect(ids("morning", { caseSensitive: true })).toEqual(["1"]);
    });

    it("applies whole-word matching", () => {
        expect(ids("morning", { wholeWord: true }).sort()).toEqual(["1", "2"]);
    });

    it("matches a regular expression, which the term path could not", () => {
        expect(ids("MORN\\w+", { regex: true }).sort()).toEqual(["1", "2", "3"]);
    });

    it("highlights from the matcher's own offsets, with no foldability caveat", () => {
        const hit = querySearchIndex(entries, "morning", {
            matcher: compileMatcher("morning", { caseSensitive: true, wholeWord: false, regex: false }),
        })[0].hits[0];
        expect(hit.titleRanges).toEqual([[5, 12]]);
    });

    it("still matches through the context line when the title does not", () => {
        const hit = querySearchIndex(entries, "Opening", {
            matcher: compileMatcher("Opening", { caseSensitive: true, wholeWord: false, regex: false }),
        })[0].hits[0];
        expect(hit.matchReason).toBe("detail");
        expect(hit.titleRanges).toEqual([]);
    });

    it("leaves the term path exactly as it was when no matcher is supplied", () => {
        expect(querySearchIndex(entries, "morning").flatMap(group => group.hits.map(hit => hit.entry.id)).sort())
            .toEqual(["1", "2", "3"]);
    });
});

describe("indexEntries", () => {
    it("precomputes case-folded haystacks", () => {
        const [entry] = indexEntries([
            { id: "1", group: "storyText", text:"Good Morning", detail: "Ch. ONE", aux: "TAG", target: { kind: "localizationKey", keyName: "x" } },
        ]);
        expect(entry.textLower).toBe("good morning");
        expect(entry.detailLower).toBe("ch. one");
        expect(entry.auxLower).toBe("tag");
        expect(entry.textFoldable).toBe(true);
    });

    it("flags text whose folding is not length-preserving so ranges are not misreported", () => {
        // "İ" (U+0130) folds to two code units, desyncing folded indices from the original.
        const [entry] = indexEntries([
            { id: "1", group: "storyText", text:"İstanbul", target: { kind: "localizationKey", keyName: "x" } },
        ]);
        expect(entry.textFoldable).toBe(false);
        const hit = querySearchIndex([entry], "stanbul")[0]?.hits[0];
        expect(hit).toBeDefined();
        expect(hit?.titleRanges).toEqual([]);
    });
});
