import { describe, expect, it } from "vitest";
import { countDocumentChanges, type DocumentChange, type DocumentDiff, type DocumentDiffEntry } from "@shared/documents/diff";
import { buildSettingsSections, isSettingsEntry } from "./settingsSections";

/**
 * Which cards a settings pane is made of, decided without mounting one.
 *
 * The two failures worth catching are both silent. A grouping that reorders the producer's rows
 * shows the author a confident, ranked, wrong answer - the spec put identity first and the areas of
 * the project in the order the panels are met, and nothing here is entitled to a second opinion.
 * And a budget that stops drawing without saying so is a comparison the author reads as complete.
 */

function leaf(path: string[], key: string, subject?: string): DocumentChange {
    return { path, kind: "changed", label: { key }, ...(subject ? { subject } : {}) };
}

function group(path: string[], key: string, children: DocumentChange[], truncated = 0): DocumentChange {
    return {
        path,
        kind: "changed",
        label: { key },
        children,
        ...(truncated ? { truncated } : {}),
    };
}

function diffOf(changes: DocumentChange[], total = countDocumentChanges(changes)): DocumentDiff {
    return { changes, complete: total === countDocumentChanges(changes), total, tier: "semantic" };
}

/** The project's own settings, as `diffProjectConfig` shapes them: two identity rows, then areas. */
const PROJECT_DIFF = diffOf([
    leaf(["name"], "documentDiff.project.name"),
    leaf(["identifier"], "documentDiff.project.identifier"),
    group(["metadata"], "documentDiff.project.metadata", [
        leaf(["metadata", "version"], "documentDiff.project.metaVersion"),
        leaf(["metadata", "resolution"], "documentDiff.project.metaResolution"),
    ]),
    group(["app", "network"], "documentDiff.project.network", [
        leaf(["app", "network", "policy"], "documentDiff.project.networkPolicy"),
    ]),
]);

describe("buildSettingsSections", () => {
    it("makes a card of every group the document named, and one of the rows it did not", () => {
        const { sections, hidden, total } = buildSettingsSections(PROJECT_DIFF, 200);

        expect(sections.map(section => section.heading?.label.key ?? null)).toEqual([
            // The two identity rows are not a group in the model and are not given an invented name.
            null,
            "documentDiff.project.metadata",
            "documentDiff.project.network",
        ]);
        expect(sections[0].diff.changes.map(change => change.path.join("/"))).toEqual(["name", "identifier"]);
        expect(sections[1].diff.changes.map(change => change.path.join("/")))
            .toEqual(["metadata/version", "metadata/resolution"]);
        // Everything is on screen, so the pane has nothing to confess.
        expect({ hidden, total }).toEqual({ hidden: 0, total: 5 });
    });

    it("carries the tier of the comparison into every section", () => {
        const { sections } = buildSettingsSections({ ...PROJECT_DIFF, tier: "structural" }, 200);

        // How a change was produced is a property of the comparison, not of which card it landed in.
        expect(sections.every(section => section.diff.tier === "structural")).toBe(true);
    });

    it("keeps a flat document as one unnamed card rather than one card per thing that changed", () => {
        // Six documents report this shape, and every row carries the author's own word for the bus,
        // the variable or the term it belongs to. Grouping by that word would print it in the
        // heading and again on every row under it, so the model's silence is taken at face value.
        const tracks = diffOf([
            leaf(["tracks", "t-bgm", "volume"], "documentDiff.audioTracks.volume", "Music"),
            leaf(["tracks", "t-bgm", "loop"], "documentDiff.audioTracks.loopOn", "Music"),
            leaf(["tracks", "t-amb", "parentId"], "documentDiff.audioTracks.rerouted", "Ambience"),
        ]);

        const { sections } = buildSettingsSections(tracks, 200);

        expect(sections).toHaveLength(1);
        expect(sections[0].heading).toBeNull();
        expect(sections[0].diff.changes).toHaveLength(3);
    });

    it("leaves a group whose children were all dropped as a row, where it can still say so", () => {
        const stripped = diffOf([group(["app", "preferences"], "documentDiff.project.preferences", [], 9)], 9);

        const { sections } = buildSettingsSections(stripped, 200);

        // A card with an empty body would report nothing at all; the row keeps its own `+9`.
        expect(sections).toHaveLength(1);
        expect(sections[0].heading).toBeNull();
        expect(sections[0].diff.changes[0].truncated).toBe(9);
    });

    it("states a group's dropped children as that section's own shortfall", () => {
        const cut = diffOf(
            [group(["app", "preferences"], "documentDiff.project.preferences", [
                leaf(["app", "preferences", "cps"], "documentDiff.project.prefTextSpeed"),
            ], 4)],
            5,
        );

        const { sections, hidden } = buildSettingsSections(cut, 200);

        // `total` above `changes.length` is what makes `DocumentChangeList` say "showing 1 of 5"
        // inside the card. Counting it in `hidden` as well would state the same omission twice.
        expect(sections[0].diff).toMatchObject({ total: 5, complete: false });
        expect(hidden).toBe(0);
    });

    it("spends one budget across the whole pane and counts what it could not draw", () => {
        const { sections, hidden, total } = buildSettingsSections(PROJECT_DIFF, 3);

        // Two identity rows and the first child of `metadata`; the section is kept with the row that
        // fits, and nothing after it is drawn.
        expect(sections.map(section => section.diff.changes.length)).toEqual([2, 1]);
        expect(sections[1].diff).toMatchObject({ total: 2, complete: false });
        // The `network` area accounts for the one leaf nobody drew and nobody else reported.
        expect({ hidden, total }).toEqual({ hidden: 1, total: 5 });
    });

    it("draws nothing rather than empty cards for a diff with no changes", () => {
        expect(buildSettingsSections(diffOf([]), 200)).toEqual({ sections: [], hidden: 0, total: 0 });
    });
});

describe("isSettingsEntry", () => {
    const entry = (documentKind?: DocumentDiffEntry["documentKind"]): DocumentDiffEntry => ({
        path: "editor/whatever.json",
        kind: "changed",
        ...(documentKind ? { documentKind } : {}),
        diff: diffOf([]),
    });

    it("claims the six documents that report a list of settings", () => {
        for (const kind of ["project", "app-tags", "audio-tracks", "variables", "save-schema", "dictionary"] as const) {
            expect(isSettingsEntry(entry(kind)), kind).toBe(true);
        }
    });

    it("leaves the palette to the presenter that can draw a colour", () => {
        expect(isSettingsEntry(entry("brand"))).toBe(false);
    });

    it("declines a document nobody classified, and a format that is not settings", () => {
        expect(isSettingsEntry(entry())).toBe(false);
        expect(isSettingsEntry(entry("story"))).toBe(false);
    });
});
