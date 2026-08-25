import {describe, expect, it} from "vitest";
import type {DocumentChange, DocumentDiff} from "@shared/documents/diff";
import {DIFF_VALUE_PREVIEW_CHARS} from "@shared/documents/specs/diffHelpers";
import {diffLocalization, merge3Localization} from "@shared/documents/specs/localization";
import {localizationDocumentSpec} from "@shared/documents/specs";
import {
    LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    characterTranslationUnitId,
    localizationKeyUnitId,
    sceneTranslationUnitId,
    type LocalizationDocument,
    type LocalizationUnit,
} from "@shared/types/localization";

/**
 * A round of translation, as the comparison reads it.
 *
 * This is the one document in the project whose entire content is the author's own text, and until
 * this diff existed a whole afternoon's work by a translator reported as a single row saying the
 * file had changed in a way the totals did not show - with no string on either side. So the
 * assertions below are about the strings: which row carries which line, and that a rewritten line
 * carries BOTH the old text and the new one. A test that counted rows would pass on a diff that
 * quotes the wrong side.
 */

const LIMIT = {limit: 200};

/** The row at one path, or undefined. The path is the document's own structure, so it is stable. */
function rowAt(diff: DocumentDiff, path: string): DocumentChange | undefined {
    return diff.changes.find(change => change.path.join("/") === path);
}

function paths(diff: DocumentDiff): string[] {
    return diff.changes.map(change => change.path.join("/"));
}

function unit(target: string, extra: Partial<LocalizationUnit> = {}): LocalizationUnit {
    return {target, sourceHash: "h-source", status: "translated", ...extra};
}

function document(locale: string, units: Record<string, LocalizationUnit>): LocalizationDocument {
    return {schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale, units};
}

/**
 * `editor/localization/ja.json` for a project part-way through its Japanese pass.
 *
 * Deliberately the shape a real one has rather than a map of `a`/`b`: story lines keyed by their
 * text id, a character's nametag, a scene's name and a named interface key, each of which sorts into
 * a different family and none of which is a word anybody typed.
 */
const NARRATION = "s1-block-04-text";
const CHOICE = "s1-block-11-choice";
const GREETING = "s2-block-02-text";
const FAREWELL = "s2-block-19-text";
const ALICE = characterTranslationUnitId("char-7f21");
const HARBOUR = sceneTranslationUnitId("scene-3a90");
const MENU_START = localizationKeyUnitId("menu.start");

const before = document("ja", {
    [NARRATION]: unit("雨は夕暮れまで降りやまなかった。"),
    [CHOICE]: unit("港へ行く", {status: "machine"}),
    [GREETING]: unit("おはよう。", {note: "朝の挨拶"}),
    [FAREWELL]: unit("またね。", {status: "reviewed"}),
    [ALICE]: unit("アリス"),
    [MENU_START]: unit("はじめる", {sourceHash: "h-start-v1"}),
});

/**
 * The same file after one translator's afternoon.
 *
 * Six edits, one of each kind the format allows: a line rewritten, a line added, a line taken away,
 * a status moved without the text moving, a note rewritten, and a line re-confirmed against a source
 * the writer had changed underneath it.
 */
const after = document("ja", {
    [NARRATION]: unit("雨は日が暮れるまで降りやまなかった。"),
    [CHOICE]: unit("港へ行く", {status: "translated"}),
    [GREETING]: unit("おはよう。", {note: "朝の挨拶。時間帯を問わない訳は避ける"}),
    [HARBOUR]: unit("夕暮れの港"),
    [ALICE]: unit("アリス"),
    [MENU_START]: unit("はじめる", {sourceHash: "h-start-v2"}),
});

describe("the translation library diff", () => {
    it("is registered on the spec", () => {
        expect(typeof localizationDocumentSpec.diff).toBe("function");
    });

    it("reports one row per translation unit and nothing about the file itself", () => {
        const diff = diffLocalization(before, after, LIMIT);

        // Sorted by unit id, which keeps the `char:`, `key:` and `scene:` families together. The
        // unchanged unit (Alice's nametag) is absent, and so are `locale` and `schemaVersion`:
        // neither can differ between two versions of one path.
        expect(paths(diff)).toEqual([
            `units/${MENU_START}/source`,
            `units/${NARRATION}`,
            `units/${CHOICE}/status`,
            `units/${GREETING}/note`,
            `units/${FAREWELL}`,
            `units/${HARBOUR}`,
        ]);
        expect(diff.tier).toBe("semantic");
        expect(diff.complete).toBe(true);
    });

    it("carries both texts of a line that was translated again", () => {
        const row = rowAt(diffLocalization(before, after, LIMIT), `units/${NARRATION}`);

        expect(row?.kind).toBe("changed");
        expect(row?.label.key).toBe("documentDiff.localization.changed");
        // The whole point of this diff: the row is answerable without opening anything, because it
        // holds the sentence as it read and the sentence as it reads now.
        expect(row?.label.params).toEqual({
            from: "雨は夕暮れまで降りやまなかった。",
            to: "雨は日が暮れるまで降りやまなかった。",
        });
    });

    it("names a row by the author's own text and never by the unit id", () => {
        const diff = diffLocalization(before, after, LIMIT);

        expect(rowAt(diff, `units/${NARRATION}`)?.subject).toBe("雨は日が暮れるまで降りやまなかった。");
        expect(rowAt(diff, `units/${HARBOUR}`)?.subject).toBe("夕暮れの港");
        // A status row has no value pair, so the text beside it is the only thing saying which line
        // was marked - and it is the translation, not `s1-block-11-choice`.
        expect(rowAt(diff, `units/${CHOICE}/status`)?.subject).toBe("港へ行く");
        for (const change of diff.changes) {
            expect(change.subject).not.toContain("block");
            expect(change.subject).not.toContain("scene:");
        }
    });

    it("reports an added line with the text that arrived, and a removed one with the text that went", () => {
        const diff = diffLocalization(before, after, LIMIT);

        const added = rowAt(diff, `units/${HARBOUR}`);
        expect(added?.kind).toBe("added");
        expect(added?.label.key).toBe("documentDiff.localization.added");
        expect(added?.label.params).toEqual({to: "夕暮れの港"});

        const removed = rowAt(diff, `units/${FAREWELL}`);
        expect(removed?.kind).toBe("removed");
        expect(removed?.label.key).toBe("documentDiff.localization.removed");
        // The line that went away, quoted from the older version - the only version that has it.
        expect(removed?.label.params).toEqual({from: "またね。"});
        expect(removed?.subject).toBe("またね。");
    });

    it("states what a unit's status now is, in the table's own words", () => {
        const row = rowAt(diffLocalization(before, after, LIMIT), `units/${CHOICE}/status`);

        expect(row?.kind).toBe("changed");
        expect(row?.label.key).toBe("documentDiff.localization.statusTranslated");
        // No value pair: `machine` and `translated` are the identifiers the file keeps, not words a
        // translator is shown anywhere.
        expect(row?.label.params).toBeUndefined();
    });

    it("reports a line re-confirmed against an edited source, and only when the text held still", () => {
        const diff = diffLocalization(before, after, LIMIT);

        expect(rowAt(diff, `units/${MENU_START}/source`)?.label.key)
            .toBe("documentDiff.localization.source");
        // The retranslated line's hash moved too, and says nothing there that its own row does not.
        expect(paths(diff)).not.toContain(`units/${NARRATION}/source`);
    });

    it("reports a rewritten note with both notes", () => {
        const row = rowAt(diffLocalization(before, after, LIMIT), `units/${GREETING}/note`);

        expect(row?.label.key).toBe("documentDiff.localization.note");
        expect(row?.label.params).toEqual({
            from: "朝の挨拶",
            to: "朝の挨拶。時間帯を問わない訳は避ける",
        });
        expect(row?.subject).toBe("おはよう。");
    });
});

describe("a unit only one version holds", () => {
    const base = document("ja", {[NARRATION]: unit("古い訳")});
    const head = document("ja", {[HARBOUR]: unit("新しい訳")});

    /**
     * The acceptance this diff was asked for: an addition and a removal are not a change.
     *
     * The failure it guards is not hypothetical - a keyed diff that reported every differing key as
     * `changed` would draw one marker for a line somebody wrote and for a line somebody deleted, and
     * the row's own colour is how those are told apart at a glance.
     */
    it("is added or removed and never changed", () => {
        const diff = diffLocalization(base, head, LIMIT);

        expect(diff.changes.map(change => change.kind).sort()).toEqual(["added", "removed"]);
        expect(rowAt(diff, `units/${HARBOUR}`)?.kind).toBe("added");
        expect(rowAt(diff, `units/${NARRATION}`)?.kind).toBe("removed");
        for (const change of diff.changes) {
            expect(change.label.key).not.toBe("documentDiff.localization.changed");
            // One side only, so one value and no arrow: there is no other version of this line.
            expect(Object.keys(change.label.params ?? {})).toHaveLength(1);
        }
    });

    it("is not a change even when a unit of the same text exists under another id", () => {
        // Two ids holding the same string are two units. Pairing them would be a rename this format
        // has no record of, guessed at from the text.
        const diff = diffLocalization(
            document("ja", {[NARRATION]: unit("同じ訳")}),
            document("ja", {[HARBOUR]: unit("同じ訳")}),
            LIMIT,
        );

        expect(diff.changes.map(change => change.kind).sort()).toEqual(["added", "removed"]);
    });
});

describe("a translation that is long, or gone", () => {
    const long = "「" + "も".repeat(200) + "」";

    it("quotes each side at the ceiling every value on this surface obeys", () => {
        const diff = diffLocalization(
            document("ja", {[NARRATION]: unit("短い訳")}),
            document("ja", {[NARRATION]: unit(long)}),
            LIMIT,
        );
        const row = rowAt(diff, `units/${NARRATION}`);

        expect(String(row?.label.params?.to)).toHaveLength(DIFF_VALUE_PREVIEW_CHARS + 1);
        expect(String(row?.label.params?.to).endsWith("…")).toBe(true);
        // The subject is the same quotation, so the surface prints the line once rather than twice.
        expect(row?.subject).toBe(row?.label.params?.to);
    });

    it("keeps both sides when a translation is cleared", () => {
        const diff = diffLocalization(
            document("ja", {[NARRATION]: unit("消される訳")}),
            document("ja", {[NARRATION]: unit("")}),
            LIMIT,
        );
        const row = rowAt(diff, `units/${NARRATION}`);

        expect(row?.kind).toBe("changed");
        // An empty newer side, present rather than dropped: the arrow with nothing after it is what
        // happened, and a row quoting only the old text would read as a removal.
        expect(row?.label.params).toEqual({from: "消される訳", to: ""});
        expect(row?.subject).toBe("消される訳");
    });

    it("collapses a translation that runs over several lines onto one", () => {
        const diff = diffLocalization(
            document("ja", {[NARRATION]: unit("一行目")}),
            document("ja", {[NARRATION]: unit("一行目\n二行目")}),
            LIMIT,
        );

        expect(rowAt(diff, `units/${NARRATION}`)?.label.params?.to).toBe("一行目 二行目");
    });
});

describe("the comparison and the merge", () => {
    /**
     * They address a unit the same way, and that is not a coincidence to be left to chance.
     *
     * A merge decision is taken on a path, and the comparison is what an author reads before taking
     * it. Two spellings of the same unit would mean the row somebody resolved and the row somebody
     * read were different rows, with nothing to say so.
     */
    it("name a unit with the same path", () => {
        const diffPaths = diffLocalization(before, after, LIMIT).changes
            .map(change => change.path.slice(0, 2).join("/"));
        const mergePaths = merge3Localization(before, before, after).decisions
            .map(decision => decision.path.join("/"));

        for (const path of diffPaths) {
            expect(mergePaths).toContain(path);
        }
        expect(mergePaths).toContain(`units/${FAREWELL}`);
    });
});
