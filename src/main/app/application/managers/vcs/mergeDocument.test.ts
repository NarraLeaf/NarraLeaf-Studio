import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import { MERGE_DECISION_LIMIT, readMergeDocument, resolveDocumentChanges } from "./mergeDocument";

/**
 * Tier two's main-process half, against real files and no backend at all.
 *
 * It needs none: a conflicted merge leaves `~base`, `~mine` and `~theirs` beside the file (docs
 * §4.23), so the three inputs of a three-way merge are three files on disk and everything this
 * module does can be driven by writing them. What a REAL merge does with the result - settling it,
 * committing it, reading the bytes back in the same process - is `merge.integration.test.ts`.
 *
 * The cases below are the ones where being wrong is silent. A blocked document that answered as
 * merged would let the author compose a resolution nothing can write; an unreadable base taken as
 * "no base" would read every key one side lacks as an addition rather than as a removal, in their
 * favour, every time.
 */

const LOCALE_PATH = "editor/localization/ja.json";
const ASSETS_PATH = "assets/assets.metadata.image.json";

const roots: string[] = [];

function tmp(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-merge-doc-")));
    roots.push(root);
    return root;
}

function write(root: string, relative: string, contents: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf-8");
}

const unit = (target: string) => ({ target, sourceHash: "h", status: "translated" });

function locale(units: Record<string, ReturnType<typeof unit>>): string {
    return `${JSON.stringify({ schemaVersion: 1, locale: "ja", units }, null, 2)}\n`;
}

/**
 * A conflicted localization file with its three sides beside it, exactly as a merge leaves them.
 *
 * `greeting` is changed by both - the only real question. Each side also adds one unit of its own,
 * which is the case tier two exists for: nothing is in dispute there and taking the whole file from
 * either side would throw one of them away.
 */
function conflictedLocale(root: string, options: { base?: boolean } = {}): void {
    write(root, LOCALE_PATH, "<<<<<<< ours\n not json\n");
    if (options.base !== false) {
        write(root, `${LOCALE_PATH}~base`, locale({ greeting: unit("base") }));
    }
    write(root, `${LOCALE_PATH}~mine`, locale({ greeting: unit("mine"), fromMine: unit("only mine") }));
    write(root, `${LOCALE_PATH}~theirs`, locale({ greeting: unit("theirs"), fromTheirs: unit("only theirs") }));
}

afterAll(() => {
    for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe("readMergeDocument", () => {
    it("merges the three copies the merge left on disk", async () => {
        const root = tmp();
        conflictedLocale(root);

        const answer = await readMergeDocument(root, LOCALE_PATH);
        expect(answer.blocked).toBeUndefined();
        expect(answer.documentKind).toBe("localization");
        expect(answer.conflicts).toBe(1);
        expect(answer.decisions.map(entry => [entry.path.join("/"), entry.outcome])).toEqual([
            ["units/greeting", "conflict"],
            ["units/fromMine", "auto-mine"],
            ["units/fromTheirs", "auto-theirs"],
        ]);
    });

    /**
     * The whole point of putting both values on the row: a translation conflict is answered by
     * reading the two translations, and a preview or a hash could not be answered at all.
     */
    it("carries both sides' values verbatim", async () => {
        const root = tmp();
        conflictedLocale(root);

        const answer = await readMergeDocument(root, LOCALE_PATH);
        const greeting = answer.decisions.find(entry => entry.path[1] === "greeting");
        expect(greeting?.mine.value).toMatchObject({ target: "mine" });
        expect(greeting?.theirs.value).toMatchObject({ target: "theirs" });
        // And a label, in both catalogues - `documentDiffKeys.test.ts` is what keeps that true.
        expect(greeting?.label?.key).toBe("documentDiff.localization.changed");
    });

    /**
     * **The measured limitation, reported rather than worked around.**
     *
     * `assetsMetadataSpec` implements `merge3` and its `serialize` throws on purpose: `AssetsService`
     * still owns writing that shard, and the asset services still assign `undefined` where the
     * canonical encoder requires an absent key. So a per-change result for an asset shard could be
     * composed and never written, and the honest answer is to keep the file at tier one and say so.
     *
     * The throw is NOT removed to make this work: doing that would rewrite the author's shard into
     * bytes its own service does not produce. The day that migration lands, this test flips from
     * `read-only` to a real decision list on its own, because the gate is a probe rather than a list
     * of spec names.
     */
    it("keeps an asset shard at tier one because its spec cannot write itself back", async () => {
        const root = tmp();
        const shard = (assets: Record<string, unknown>) => `${JSON.stringify(assets, null, 2)}\n`;
        write(root, ASSETS_PATH, "<<<<<<< ours\n");
        write(root, `${ASSETS_PATH}~base`, shard({ a: { id: "a", name: "one" } }));
        write(root, `${ASSETS_PATH}~mine`, shard({ a: { id: "a", name: "mine" } }));
        write(root, `${ASSETS_PATH}~theirs`, shard({ a: { id: "a", name: "theirs" } }));

        const answer = await readMergeDocument(root, ASSETS_PATH);
        expect(answer.blocked).toBe("read-only");
        expect(answer.decisions).toEqual([]);
        // The spec's own sentence, so the author is told which migration is missing rather than
        // "not supported".
        expect(answer.detail).toMatch(/read-only|AssetsService/i);
    });

    it("reports a path no spec claims", async () => {
        const root = tmp();
        write(root, "notes.txt", "conflicted");
        write(root, "notes.txt~mine", "mine");
        write(root, "notes.txt~theirs", "theirs");

        expect((await readMergeDocument(root, "notes.txt")).blocked).toBe("no-spec");
    });

    it("reports a spec with no three-way merge", async () => {
        const root = tmp();
        const document = `${JSON.stringify({ schemaVersion: 1, tracks: [] }, null, 2)}\n`;
        write(root, "editor/audio-tracks.json", "<<<<<<< ours");
        write(root, "editor/audio-tracks.json~mine", document);
        write(root, "editor/audio-tracks.json~theirs", document);

        expect((await readMergeDocument(root, "editor/audio-tracks.json")).blocked).toBe("no-merge3");
    });

    it("reports a side that is not there", async () => {
        const root = tmp();
        conflictedLocale(root);
        fs.rmSync(path.join(root, `${LOCALE_PATH}~theirs`));

        const answer = await readMergeDocument(root, LOCALE_PATH);
        expect(answer.blocked).toBe("unreadable");
    });

    /**
     * A `~base` that exists and cannot be parsed is NOT quietly downgraded to add/add.
     *
     * Doing so would turn an unreadable ancestor into "the two sides share no history", which reads
     * every key one side lacks as an addition rather than as a removal - silently, and in this
     * author's favour every time.
     */
    it("refuses rather than treating an unreadable base as no base", async () => {
        const root = tmp();
        conflictedLocale(root);
        write(root, `${LOCALE_PATH}~base`, "{ not json");

        expect((await readMergeDocument(root, LOCALE_PATH)).blocked).toBe("unreadable");
    });

    /** No base at all IS add/add, which `mergeKeyed` answers as conflicts rather than as merges. */
    it("treats a missing base as add/add", async () => {
        const root = tmp();
        conflictedLocale(root, { base: false });

        const answer = await readMergeDocument(root, LOCALE_PATH);
        expect(answer.blocked).toBeUndefined();
        expect(answer.conflicts).toBe(3);
    });

    /**
     * Past the cap the document falls BACK to tier one rather than being truncated: a partial
     * decision list cannot be applied at all, because whatever it left out would have to be settled
     * by something other than the author.
     */
    it("falls back to tier one rather than truncating a huge decision list", async () => {
        const root = tmp();
        const many = (prefix: string) => Object.fromEntries(
            Array.from({ length: MERGE_DECISION_LIMIT + 1 }, (_, index) => [`${prefix}${index}`, unit("x")]),
        );
        write(root, LOCALE_PATH, "<<<<<<< ours");
        write(root, `${LOCALE_PATH}~base`, locale({}));
        write(root, `${LOCALE_PATH}~mine`, locale(many("mine")));
        write(root, `${LOCALE_PATH}~theirs`, locale(many("theirs")));

        const answer = await readMergeDocument(root, LOCALE_PATH);
        expect(answer.blocked).toBe("too-many");
        expect(answer.decisions).toEqual([]);
    });
});

describe("resolveDocumentChanges", () => {
    it("writes a document neither side wrote", async () => {
        const root = tmp();
        conflictedLocale(root);

        await resolveDocumentChanges(root, LOCALE_PATH, {
            [mergeDecisionKey(["units", "greeting"])]: "theirs",
        });

        const written = JSON.parse(fs.readFileSync(path.join(root, LOCALE_PATH), "utf-8"));
        expect(written.units.greeting.target).toBe("theirs");
        // Both sides' own additions survive, which is the whole reason for the tier: taking the file
        // whole from either side would have thrown one of them away.
        expect(written.units.fromMine.target).toBe("only mine");
        expect(written.units.fromTheirs.target).toBe("only theirs");
    });

    it("refuses when a conflict was left undecided, and writes nothing", async () => {
        const root = tmp();
        conflictedLocale(root);
        const before = fs.readFileSync(path.join(root, LOCALE_PATH), "utf-8");

        await expect(resolveDocumentChanges(root, LOCALE_PATH, {})).rejects.toThrow(/greeting/);
        expect(fs.readFileSync(path.join(root, LOCALE_PATH), "utf-8")).toBe(before);
    });

    it("refuses a document that has no per-change tier, naming the reason", async () => {
        const root = tmp();
        write(root, "notes.txt", "conflicted");
        write(root, "notes.txt~mine", "mine");
        write(root, "notes.txt~theirs", "theirs");

        await expect(resolveDocumentChanges(root, "notes.txt", {})).rejects.toThrow(/no-spec/);
    });

    /**
     * Two gates catch this and the outer one fires first: the registry refuses to resolve a spec
     * for a path with a `..` segment at all, so an escaping path is `no-spec` before the path guard
     * inside ever runs. Asserted by what did NOT happen rather than by which sentence came back -
     * the guard that matters is that nothing was written above the root, and it holds either way.
     */
    it("refuses a path outside the repository", async () => {
        const root = tmp();
        const outside = path.join(path.dirname(root), "escape.json");
        fs.rmSync(outside, { force: true });

        await expect(resolveDocumentChanges(root, "../escape.json", {})).rejects.toThrow();
        expect(fs.existsSync(outside)).toBe(false);
    });
});
