// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { diffCharacterStore } from "@shared/documents/specs/charactersDiff";
import type { CharacterStoreDocument } from "@shared/characters/characterStoreModel";
import type { StoredCharacter } from "@shared/types/character/model";
import { ChangeDetailHost } from "./ChangeDetailHost";

/**
 * The cast, drawn the way an author meets it.
 *
 * Mounted through `ChangeDetailHost` rather than directly, so the registry's answer is under test as
 * well as the pane: a presenter that draws perfectly and is never chosen is the same generic list it
 * replaced.
 *
 * The diff is produced by the real spec from a real pair of stores, because the shape this pane
 * relies on - one row per character with that character's leaves under it - is the spec's decision
 * and not this file's. A hand-built diff would keep passing after the spec stopped producing
 * children at all.
 *
 * Keys rather than English: which words are on screen is the catalogue's business. The VALUES are
 * the author's own data, so they are asserted verbatim.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        // The bare key, plus the one parameter this pane rewrites. Everything else stays out: a mock
        // that pasted every parameter into the label would print each row's two values twice.
        t: (key: string, params?: Record<string, string | number>) =>
            (params?.field === undefined ? key : `${key} ${params.field}`),
        has: () => false,
        tn: (key: string) => key,
    }),
}));

afterEach(cleanup);

function character(id: string, name: string, overrides: Partial<StoredCharacter["profile"]> = {}): StoredCharacter {
    return {
        profile: {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            appearance: { kind: "preset", poses: [], defaultPoseId: null },
            ...overrides,
        },
    };
}

const alice = character("c-alice", "Alice", {
    color: "#40a8c4",
    appearance: {
        kind: "preset",
        poses: [
            { id: "p-calm", name: "Calm", assetId: "asset-calm" },
            { id: "p-angry", name: "Angry", assetId: "asset-angry" },
        ],
        defaultPoseId: "p-calm",
    },
});

const base: CharacterStoreDocument = {
    version: 2,
    characters: [alice, character("c-clara", "Clara")],
    groups: { "g-leads": { id: "g-leads", name: "Leads", createdAt: 1, updatedAt: 1 } },
};

/** One evening's edits: a differential repainted, an accent changed, one arrival, one departure, a group renamed. */
const head: CharacterStoreDocument = {
    version: 2,
    characters: [
        character("c-alice", "Alice", {
            color: "#da6958",
            defaultAvatarAssetId: "asset-face",
            appearance: {
                kind: "preset",
                poses: [
                    { id: "p-calm", name: "Calm", assetId: "asset-calm" },
                    { id: "p-angry", name: "Angry", assetId: "asset-angry-repaint" },
                ],
                defaultPoseId: "p-calm",
            },
        }),
        character("c-bruno", "Bruno"),
    ],
    groups: { "g-leads": { id: "g-leads", name: "Main cast", createdAt: 1, updatedAt: 2 } },
};

const entry: DocumentDiffEntry = {
    path: "editor/services/character.json",
    kind: "changed",
    documentKind: "characters",
    diff: diffCharacterStore(base, head, { limit: 200 }),
};

const cards = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>("[data-character-section]")];

/** The two values a row sits between: monospaced, and not the change marker, which is decorative. */
const values = (scope: HTMLElement): string[] =>
    [...scope.querySelectorAll("span.font-mono:not([aria-hidden])")].map(node => node.textContent ?? "");

describe("a project's cast", () => {
    it("is drawn by the character presenter and by nothing else", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        const mounted = container.querySelectorAll("[data-change-presenter]");
        expect(mounted).toHaveLength(1);
        expect(mounted[0].getAttribute("data-change-presenter")).toBe("characters");
    });

    it("makes a card of the character it can detail, and one list each of the cast and the groups", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        expect(cards(container).map(card => card.getAttribute("data-character-section"))).toEqual([
            // The arrival and the departure have nothing under them, so they are what happened to
            // the cast rather than two cards with empty bodies.
            "cast",
            "characters/c-alice",
            "groups",
        ]);
    });

    it("names the card with the author's own name for the character and the marker their row wore", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [, aliceCard] = cards(container);

        expect(aliceCard.textContent).toContain("Alice");
        expect(aliceCard.textContent).toContain("documentDiff.characters.changed");
    });

    it("puts a repainted differential under the character, named by the pose", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [, aliceCard] = cards(container);

        // The row this whole tier exists for: named by the pose the author named, not by two asset
        // ids at the end of a JSON path.
        expect(aliceCard.textContent).toContain("Angry");
        expect(aliceCard.textContent).toContain("documentDiff.characters.poseAsset");
    });

    it("gives each field the word the character editor uses for it", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [, aliceCard] = cards(container);

        // Not `color` and `defaultAvatarAssetId`, which is what the document stores them under.
        expect(aliceCard.textContent).toContain("characters.properties.color");
        expect(aliceCard.textContent).toContain("characters.properties.defaultAvatar");
        expect(aliceCard.textContent).not.toContain("defaultAvatarAssetId");
        // The accent, with the two values the author can compare.
        expect(values(aliceCard)).toContain("#40a8c4");
        expect(values(aliceCard)).toContain("#da6958");
    });

    it("lists the cast's own changes and the groups without inventing a name for either", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [cast, , groups] = cards(container);

        expect(cast.textContent).toContain("Bruno");
        expect(cast.textContent).toContain("documentDiff.characters.added");
        expect(cast.textContent).toContain("Clara");
        expect(cast.textContent).toContain("documentDiff.characters.removed");
        expect(groups.textContent).toContain("Main cast");
        expect(groups.textContent).toContain("documentDiff.characters.groupRenamed");
    });

    it("says nothing about a tier, because a card already claims the strongest one", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        // `semantic` is the one tier with no caveat to make. A caption per card would be the same
        // caveat three times over, which is the noise the sections exist to remove.
        expect(container.textContent).not.toContain("documentDiff.tier.");
    });
});

describe("a cast the cards cannot claim", () => {
    it("falls back to the plain list, with the caveat that list states", () => {
        const structural: DocumentDiffEntry = { ...entry, diff: { ...entry.diff, tier: "structural" } };

        const { container } = render(<ChangeDetailHost entry={structural} />);

        // Still one presenter, and still this one - the fallback is a body it renders, not a second
        // presenter that got mounted beside it.
        const mounted = container.querySelectorAll("[data-change-presenter]");
        expect(mounted).toHaveLength(1);
        expect(mounted[0].getAttribute("data-change-presenter")).toBe("characters");

        expect(cards(container)).toHaveLength(0);
        // A list of JSON paths is a weaker claim than a list of characters and has to say so.
        expect(container.textContent).toContain("documentDiff.tier.structural");
    });

    it("keeps the editor's word for a field in the list it falls back to", () => {
        const selected = entry.diff.changes.find(change => (change.children?.length ?? 0) > 0);

        const { container } = render(<ChangeDetailHost entry={entry} change={selected} />);

        // One card holding one character says less than the row does, so this is the plain list -
        // and a field must not change its name depending on how the author got to it.
        expect(cards(container)).toHaveLength(0);
        expect(container.textContent).toContain("characters.properties.color");
    });

    it("states the file that appeared as one fact rather than as an empty pane", () => {
        const added: DocumentDiffEntry = {
            path: "editor/services/character.json",
            kind: "added",
            documentKind: "characters",
            diff: {
                changes: [{ path: [], kind: "added", label: { key: "documentDiff.document.added", params: { bytes: 4096 } } }],
                complete: true,
                total: 1,
                tier: "opaque",
            },
        };

        const { container } = render(<ChangeDetailHost entry={added} />);

        expect(cards(container)).toHaveLength(0);
        expect(container.textContent).toContain("documentDiff.document.added");
        // The caveat about how it was compared stays suppressed, because nothing was compared.
        expect(container.textContent).not.toContain("documentDiff.tier.opaque");
    });
});
