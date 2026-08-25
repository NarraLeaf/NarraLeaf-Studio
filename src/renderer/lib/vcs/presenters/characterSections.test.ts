import { describe, expect, it } from "vitest";
import {
    countDocumentChanges,
    type DocumentChange,
    type DocumentDiff,
    type DocumentDiffEntry,
} from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import {
    buildCharacterSections,
    CHARACTER_FIELD_NAME_KEY,
    isCharacterEntry,
    nameCharacterFields,
} from "./characterSections";

/**
 * Which cards a cast pane is made of, decided without mounting one.
 *
 * The failures worth catching are silent ones. A grouping that scatters the cast's own rows between
 * the character cards reads as five unrelated lists; a budget that stops drawing without saying so
 * is a comparison the author reads as complete; and a field name left as the key it is stored under
 * puts `defaultAvatarAssetId` in front of somebody who set a dialogue avatar.
 */

function leaf(path: string[], key: string, params?: Record<string, string | number>): DocumentChange {
    return { path, kind: "changed", label: { key, ...(params ? { params } : {}) } };
}

function character(id: string, name: string, children: DocumentChange[], truncated = 0): DocumentChange {
    return {
        path: ["characters", id],
        kind: "changed",
        label: { key: "documentDiff.characters.changed" },
        subject: name,
        children,
        ...(truncated ? { truncated } : {}),
    };
}

function diffOf(changes: DocumentChange[], total = countDocumentChanges(changes)): DocumentDiff {
    return { changes, complete: total === countDocumentChanges(changes), total, tier: "semantic" };
}

/** An evening's edits, as `diffCharacterStore` orders them: the cast, then characters by name, then groups. */
const CAST_DIFF = diffOf([
    { path: ["characters"], kind: "moved", label: { key: "documentDiff.characters.castOrder" } },
    character("c-alice", "Alice", [
        leaf(["characters", "c-alice", "appearance", "poses", "p-angry", "assetId"], "documentDiff.characters.poseAsset"),
        leaf(["characters", "c-alice", "color"], "documentDiff.characters.profileField", { field: "color" }),
    ]),
    {
        path: ["characters", "c-bruno"],
        kind: "added",
        label: { key: "documentDiff.characters.added" },
        subject: "Bruno",
    },
    character("c-clara", "Clara", [
        leaf(["characters", "c-clara", "description"], "documentDiff.characters.profileField", { field: "description" }),
    ]),
    {
        path: ["groups", "g-leads"],
        kind: "changed",
        label: { key: "documentDiff.characters.groupRenamed" },
        subject: "Leads",
    },
]);

describe("buildCharacterSections", () => {
    it("makes a card of every character whose changes it can list", () => {
        const { sections, hidden, total } = buildCharacterSections(CAST_DIFF, 200);

        expect(sections.map(section => section.key)).toEqual([
            // What happened to the cast: its order, and the character who arrived with no detail
            // under him. A card for Bruno would be a heading over an empty body.
            "cast",
            "characters/c-alice",
            "characters/c-clara",
            "groups",
        ]);
        expect(sections[0].diff.changes.map(change => change.subject ?? "")).toEqual(["", "Bruno"]);
        expect(sections[1].heading?.subject).toBe("Alice");
        expect(sections[3].diff.changes.map(change => change.subject)).toEqual(["Leads"]);
        // Everything is on screen, so the pane has nothing to confess.
        expect({ hidden, total }).toEqual({ hidden: 0, total: 6 });
    });

    it("keeps the producer's order inside every run", () => {
        const { sections } = buildCharacterSections(CAST_DIFF, 200);

        // The spec sorted the cast by the author's own name; the cards are in that order and the
        // rows inside each one are in the order the character's leaves were built.
        expect(sections[1].diff.changes.map(change => change.label.key)).toEqual([
            "documentDiff.characters.poseAsset",
            "documentDiff.characters.profileField",
        ]);
    });

    it("carries the tier of the comparison into every section", () => {
        const { sections } = buildCharacterSections({ ...CAST_DIFF, tier: "structural" }, 200);

        // How a change was produced is a property of the comparison, not of which card it landed in.
        expect(sections.every(section => section.diff.tier === "structural")).toBe(true);
    });

    it("leaves a character whose children were all dropped on the cast list, where it can still say so", () => {
        const stripped = diffOf([character("c-alice", "Alice", [], 9)], 9);

        const { sections } = buildCharacterSections(stripped, 200);

        // A card with an empty body would report nothing at all; the row keeps its own `+9`.
        expect(sections).toHaveLength(1);
        expect(sections[0].key).toBe("cast");
        expect(sections[0].diff.changes[0].truncated).toBe(9);
    });

    it("states a character's dropped leaves as that card's own shortfall", () => {
        const cut = diffOf(
            [character("c-alice", "Alice", [leaf(["characters", "c-alice", "color"], "documentDiff.characters.profileField")], 4)],
            5,
        );

        const { sections, hidden } = buildCharacterSections(cut, 200);

        // `total` above `changes.length` is what makes `DocumentChangeList` say "showing 1 of 5"
        // inside the card. Counting it in `hidden` as well would state the same omission twice.
        expect(sections[0].diff).toMatchObject({ total: 5, complete: false });
        expect(hidden).toBe(0);
    });

    it("spends one budget across the whole pane and counts what it could not draw", () => {
        const { sections, hidden, total } = buildCharacterSections(CAST_DIFF, 3);

        // The cast's two rows and the first of Alice's; the card is kept with the row that fits, and
        // nothing after it is drawn.
        expect(sections.map(section => section.diff.changes.length)).toEqual([2, 1]);
        expect(sections[1].diff).toMatchObject({ total: 2, complete: false });
        // Clara's one leaf and the group row account for what nobody drew and nobody else reported.
        expect({ hidden, total }).toEqual({ hidden: 2, total: 6 });
    });

    it("draws nothing rather than empty cards for a diff with no changes", () => {
        expect(buildCharacterSections(diffOf([]), 200)).toEqual({ sections: [], hidden: 0, total: 0 });
    });
});

describe("nameCharacterFields", () => {
    /** Loud enough to see in an assertion, and not a word any catalogue holds. */
    const t = (key: TranslationKey) => `<${key}>`;

    it("gives a field the word the panel the author edits it in uses", () => {
        const [row] = nameCharacterFields(
            [leaf(["characters", "c-alice", "defaultAvatarAssetId"], "documentDiff.characters.profileField", {
                field: "defaultAvatarAssetId",
                from: "",
                to: "asset-7",
            })],
            t,
        );

        expect(row.label.params).toEqual({
            field: "<characters.properties.defaultAvatar>",
            from: "",
            to: "asset-7",
        });
    });

    it("reaches the leaves under a character, which is where the fields are", () => {
        const [row] = nameCharacterFields(
            [character("c-alice", "Alice", [
                leaf(["characters", "c-alice", "appearance", "backend"], "documentDiff.characters.appearanceField", {
                    field: "backend",
                }),
            ])],
            t,
        );

        expect(row.children?.[0].label.params?.field).toBe("<characters.editor.puppet.backend>");
        // The heading itself is untouched: the author's own name for the character, as the spec set it.
        expect(row.subject).toBe("Alice");
    });

    it("leaves a field the editor has no word for exactly as the document stores it", () => {
        const stored = leaf(["characters", "c-alice", "nicknames"], "documentDiff.characters.profileField", {
            field: "nicknames",
        });

        const [row] = nameCharacterFields([stored], t);

        // Unchanged, and the same object: a word invented here would read to the author as the
        // panel's own.
        expect(row).toBe(stored);
    });

    it("names no field the character editor does not", () => {
        // Every key must be one the panel already draws. A key that only exists for this pane is a
        // second vocabulary for the same thing, which is the drift the reuse rule exists to stop.
        for (const key of Object.values(CHARACTER_FIELD_NAME_KEY)) {
            expect(key.startsWith("characters.") || key.startsWith("common."), key).toBe(true);
        }
    });
});

describe("isCharacterEntry", () => {
    const entry = (documentKind?: DocumentDiffEntry["documentKind"]): DocumentDiffEntry => ({
        path: "editor/services/character.json",
        kind: "changed",
        ...(documentKind ? { documentKind } : {}),
        diff: diffOf([]),
    });

    it("claims the cast and nothing else", () => {
        expect(isCharacterEntry(entry("characters"))).toBe(true);
        expect(isCharacterEntry(entry())).toBe(false);
        expect(isCharacterEntry(entry("story"))).toBe(false);
    });
});
