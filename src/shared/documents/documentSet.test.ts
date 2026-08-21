import {describe, expect, it} from "vitest";
import {
    NOTEBOOK_SCHEMA_VERSION,
    notebookLookup,
    notebookManifest,
    notebookManifestPath,
    notebookPage,
    notebookPagePath,
    notebookSpec,
    type NotebookDocument,
} from "./__fixtures__/syntheticDocumentSet";
import {encodeCanonicalJson} from "./canonicalJson";
import {
    assembleDocumentSet,
    defineDocumentSetSpec,
    documentSetAt,
    DocumentSetIncompleteError,
    documentSetPathsAmong,
    documentSetPartsFrom,
    DocumentSetWriteError,
    foldDocumentSetPaths,
    isDocumentSetSpec,
    serializeDocumentSet,
} from "./documentSet";
import {applyMergeDecisions, mergeDecisionKey} from "./mergeApply";
import {resolveDocumentSpecForPath} from "./registry";
import {DocumentCorruptError, type DocumentKind, type DocumentParseContext} from "./types";
import "./specs";

/**
 * One document stored as several files, proven on a set that ships nowhere.
 *
 * The cases below are the ones where being wrong is silent rather than loud. A member path that
 * resolved to nothing would degrade a whole story to a generic JSON walk with the right-looking
 * rows on screen; a round trip that dropped a field would drop it from the author's project; and a
 * decision routed to the wrong file would settle a change the author never saw, in a file they will
 * not re-read.
 */

const KEY = {notebookId: "n1"};

function context(path: string): DocumentParseContext {
    return {
        path,
        corrupt(reason, options) {
            throw new DocumentCorruptError({
                kind: notebookSpec.kind,
                path,
                reason,
                text: "",
                cause: options?.cause,
            });
        },
    };
}

function notebookOf(pages: Record<string, {title: string; lines: string[]}>, order?: string[]): NotebookDocument {
    const raw = new Map<string, unknown>([
        [notebookManifestPath("n1"), notebookManifest({id: "n1", title: "Field notes", pageOrder: order ?? Object.keys(pages)})],
        ...Object.entries(pages).map(([id, page]) => [notebookPagePath("n1", id), page] as const),
    ]);
    return assembleDocumentSet(notebookSpec, documentSetPartsFrom(notebookSpec, KEY, raw), context(notebookManifestPath("n1")));
}

describe("a set's paths", () => {
    it("resolves a member path to the whole document, naming which member it is", () => {
        const location = notebookLookup("editor/notebooks/n1/pages/p2.json");

        expect(location).toMatchObject({
            role: "member",
            memberId: "p2",
            key: {notebookId: "n1"},
            manifestPath: "editor/notebooks/n1/notebook.json",
        });
        expect(location?.spec.kind).toBe(notebookSpec.kind);
    });

    it("resolves the manifest to the same document, with no member", () => {
        const location = notebookLookup("editor/notebooks/n1/notebook.json");

        expect(location).toMatchObject({role: "manifest", manifestPath: "editor/notebooks/n1/notebook.json"});
        expect(location?.memberId).toBeUndefined();
    });

    it("does not claim a path outside the set, or one that is not project-relative", () => {
        expect(notebookLookup("editor/notebooks/n1/cover.png")).toBeUndefined();
        expect(notebookLookup("assets/content/99/55/3d15abb")).toBeUndefined();
        // Lore reports absolute paths, and one of them must not take out the comparison it is in.
        expect(notebookLookup("D:/projects/demo/editor/notebooks/n1/notebook.json")).toBeUndefined();
    });

    it("addresses both files through pathFor, by which parameters it is handed", () => {
        expect(notebookSpec.pathFor({notebookId: "n1"})).toBe("editor/notebooks/n1/notebook.json");
        expect(notebookSpec.pathFor({notebookId: "n1", pageId: "p2"})).toBe("editor/notebooks/n1/pages/p2.json");
    });

    it("matches both files, so the registry routes either of them here", () => {
        expect(notebookSpec.matches("editor/notebooks/n1/notebook.json")).toBe(true);
        expect(notebookSpec.matches("editor/notebooks/n1/pages/p2.json")).toBe(true);
        expect(isDocumentSetSpec(notebookSpec)).toBe(true);
    });
});

describe("declaring a set", () => {
    const layout = {
        kind: "test-broken" as unknown as DocumentKind,
        version: 1,
        parse: (raw: unknown) => raw,
        summarize: () => ({title: "", counts: []}),
        assemble: (parts: {manifest: unknown}) => parts.manifest,
        disassemble: () => ({manifest: {}, members: new Map<string, unknown>()}),
    };

    it("refuses a member family that does not carry the manifest's parameters", () => {
        // Without <notebookId> every notebook's pages would live in one namespace, so two
        // documents would share members and a decision would route into the wrong project file.
        expect(() => defineDocumentSetSpec({
            ...layout,
            manifestPath: "editor/notebooks/<notebookId>/notebook.json",
            memberPath: "editor/pages/<pageId>.json",
        })).toThrow(/does not take <notebookId>/);
    });

    it("refuses a member family with no id of its own, or with two", () => {
        expect(() => defineDocumentSetSpec({
            ...layout,
            manifestPath: "editor/notebooks/<notebookId>/notebook.json",
            memberPath: "editor/notebooks/<notebookId>/page.json",
        })).toThrow(/exactly one parameter beyond the manifest's/);
        expect(() => defineDocumentSetSpec({
            ...layout,
            manifestPath: "editor/notebooks/<notebookId>/notebook.json",
            memberPath: "editor/notebooks/<notebookId>/<chapterId>/<pageId>.json",
        })).toThrow(/exactly one parameter beyond the manifest's/);
    });
});

describe("folding paths into documents", () => {
    it("folds every path of one set into one unit, named by its manifest", () => {
        const units = foldDocumentSetPaths([
            "editor/notebooks/n1/pages/p2.json",
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n1/pages/p1.json",
        ], notebookLookup);

        expect(units).toHaveLength(1);
        expect(units[0]).toMatchObject({kind: "set", path: "editor/notebooks/n1/notebook.json"});
        expect(units[0].kind === "set" && units[0].paths).toEqual([
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n1/pages/p1.json",
            "editor/notebooks/n1/pages/p2.json",
        ]);
    });

    it("keeps two notebooks apart, and leaves everything else one unit per file", () => {
        const units = foldDocumentSetPaths([
            "editor/notebooks/n2/pages/p1.json",
            "assets/content/99/55/3d15abb",
            "editor/notebooks/n1/pages/p1.json",
            "editor/brand.json",
        ], notebookLookup);

        expect(units.map(unit => unit.path)).toEqual([
            "assets/content/99/55/3d15abb",
            "editor/brand.json",
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n2/notebook.json",
        ]);
        expect(units.filter(unit => unit.kind === "set")).toHaveLength(2);
    });

    it("folds a set whose manifest did not change, and still names it by the manifest", () => {
        // The ordinary case for an edit: one page changed, the manifest did not. The unit's own
        // path is therefore a path that is NOT in the list it was built from.
        const units = foldDocumentSetPaths(["editor/notebooks/n1/pages/p1.json"], notebookLookup);

        expect(units[0]).toMatchObject({kind: "set", path: "editor/notebooks/n1/notebook.json"});
        expect(units[0].kind === "set" && units[0].paths).toEqual(["editor/notebooks/n1/pages/p1.json"]);
    });

    it("does not depend on the order the paths arrived in", () => {
        const paths = ["editor/z.json", "editor/notebooks/n1/pages/p1.json", "editor/a.json"];
        const forwards = foldDocumentSetPaths(paths, notebookLookup).map(unit => unit.path);
        const backwards = foldDocumentSetPaths([...paths].reverse(), notebookLookup).map(unit => unit.path);

        expect(forwards).toEqual(backwards);
    });
});

describe("the files a set is made of", () => {
    const listing = [
        "editor/notebooks/n1/notebook.json",
        "editor/notebooks/n1/pages/p1.json",
        "editor/notebooks/n1/pages/p2.json",
        "editor/notebooks/n1/cover.png",
        "editor/notebooks/n2/notebook.json",
        "editor/notebooks/n2/pages/p1.json",
        "editor/brand.json",
    ];

    it("takes its own manifest and members out of a listing and nothing else", () => {
        expect(documentSetPathsAmong(notebookSpec, KEY, listing)).toEqual([
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n1/pages/p1.json",
            "editor/notebooks/n1/pages/p2.json",
        ]);
    });

    it("answers without the manifest when the listing has none", () => {
        // A side of a comparison that does not hold this document at all still has to be described,
        // and inventing a manifest path that is not there would make it look present.
        expect(documentSetPathsAmong(notebookSpec, KEY, ["editor/notebooks/n1/pages/p1.json"]))
            .toEqual(["editor/notebooks/n1/pages/p1.json"]);
    });

    it("refuses to assemble a set with no manifest rather than inventing an empty one", () => {
        const raw = new Map<string, unknown>([[notebookPagePath("n1", "p1"), notebookPage("One", ["a"])]]);

        expect(() => documentSetPartsFrom(notebookSpec, KEY, raw)).toThrow(DocumentSetIncompleteError);
    });
});

describe("assembling and taking apart", () => {
    it("hands the format one whole document, holding what no single file holds", () => {
        const document = notebookOf({
            p1: {title: "One", lines: ["a", "b"]},
            p2: {title: "Two", lines: ["c"]},
        }, ["p2", "p1"]);

        expect(document.title).toBe("Field notes");
        expect(document.pageOrder).toEqual(["p2", "p1"]);
        expect(document.pages.p1.lines).toEqual(["a", "b"]);
        expect(document.schemaVersion).toBe(NOTEBOOK_SCHEMA_VERSION);
    });

    it("folds in a member the manifest does not mention", () => {
        // Rule 1: members are enumerated by path. A file the manifest forgot is still part of the
        // document, and it is the format - not this layer - that decides what to do with it.
        const raw = new Map<string, unknown>([
            [notebookManifestPath("n1"), notebookManifest({id: "n1", pageOrder: ["p1"]})],
            [notebookPagePath("n1", "p1"), notebookPage("One", ["a"])],
            [notebookPagePath("n1", "stray"), notebookPage("Stray", ["x"])],
        ]);

        const document = assembleDocumentSet(notebookSpec, documentSetPartsFrom(notebookSpec, KEY, raw), context("x"));

        expect(document.pageOrder).toEqual(["p1", "stray"]);
    });

    it("round-trips: parse(assemble(disassemble(d))) is d", () => {
        const document = notebookOf({
            p1: {title: "One", lines: ["a", "b"]},
            p2: {title: "Two", lines: []},
        }, ["p2", "p1"]);

        const parts = notebookSpec.set.disassemble(document);
        const again = assembleDocumentSet(notebookSpec, parts, context("x"));

        expect(again).toEqual(document);
    });

    it("reports a corrupt manifest through the parse context, not as a bare throw", () => {
        const raw = new Map<string, unknown>([[notebookManifestPath("n1"), "not an object"]]);

        expect(() => assembleDocumentSet(notebookSpec, documentSetPartsFrom(notebookSpec, KEY, raw), context("n1")))
            .toThrow(DocumentCorruptError);
    });
});

describe("writing a set", () => {
    it("refuses to be written to one path", () => {
        const document = notebookOf({p1: {title: "One", lines: ["a"]}});

        // The default encoder would answer with the assembled document, which is a file that exists
        // nowhere - and `saveDocument` would write it over the manifest, collapsing the set.
        expect(() => notebookSpec.serialize(document)).toThrow(DocumentSetWriteError);
    });

    it("answers with the bytes of every file, keyed by path", () => {
        const document = notebookOf({p1: {title: "One", lines: ["a"]}, p2: {title: "Two", lines: []}});

        const bytes = serializeDocumentSet(notebookSpec, KEY, document);

        expect([...bytes.keys()].sort()).toEqual([
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n1/pages/p1.json",
            "editor/notebooks/n1/pages/p2.json",
        ]);
        expect(bytes.get("editor/notebooks/n1/pages/p1.json")).toBe(encodeCanonicalJson({title: "One", lines: ["a"]}));
        // The manifest keeps the order and none of the page contents.
        expect(JSON.parse(bytes.get("editor/notebooks/n1/notebook.json") as string)).toEqual({
            schemaVersion: NOTEBOOK_SCHEMA_VERSION,
            id: "n1",
            title: "Field notes",
            pageOrder: ["p1", "p2"],
        });
    });
});

describe("routing a decision back to the file that owns it", () => {
    /**
     * The whole point of rule 2, end to end: merge the whole document, answer one change, and see
     * exactly one member's bytes move.
     *
     * Nothing here derives an owning file from a change path. The settled document is taken apart
     * again and the parts are compared, so a change that touched two files would show as two.
     */
    it("moves only the bytes of the member the change landed in", () => {
        const base = notebookOf({p1: {title: "One", lines: ["a"]}, p2: {title: "Two", lines: ["c"]}});
        const mine = notebookOf({p1: {title: "One", lines: ["a", "mine"]}, p2: {title: "Two", lines: ["c"]}});
        const theirs = notebookOf({p1: {title: "One", lines: ["a", "theirs"]}, p2: {title: "Two", lines: ["c"]}});

        const merged = notebookSpec.merge3?.(base, mine, theirs);
        expect(merged?.conflicts).toBe(1);
        expect(merged?.decisions.map(decision => decision.path)).toEqual([["pages", "p1"]]);

        const settled = applyMergeDecisions(
            notebookManifestPath("n1"),
            merged?.document as NotebookDocument,
            merged?.decisions ?? [],
            {[mergeDecisionKey(["pages", "p1"])]: "theirs"},
        );

        const before = serializeDocumentSet(notebookSpec, KEY, mine);
        const after = serializeDocumentSet(notebookSpec, KEY, settled);
        const moved = [...after.keys()].filter(path => after.get(path) !== before.get(path));

        expect(moved).toEqual(["editor/notebooks/n1/pages/p1.json"]);
        expect(JSON.parse(after.get(moved[0]) as string).lines).toEqual(["a", "theirs"]);
    });

    it("moves the manifest's bytes when the change is the manifest's", () => {
        // A page only theirs has: the decision is addressed at `["pages", ...]`, but taking it
        // rewrites the order the MANIFEST owns as well as adding a member file. Path arithmetic
        // over the change path could not have known that; disassembly does.
        const base = notebookOf({p1: {title: "One", lines: ["a"]}});
        const mine = base;
        const theirs = notebookOf({p1: {title: "One", lines: ["a"]}, p9: {title: "Nine", lines: ["n"]}});

        const merged = notebookSpec.merge3?.(base, mine, theirs);
        const settled = applyMergeDecisions(
            notebookManifestPath("n1"),
            merged?.document as NotebookDocument,
            merged?.decisions ?? [],
            {},
        );

        const before = serializeDocumentSet(notebookSpec, KEY, mine);
        const after = serializeDocumentSet(notebookSpec, KEY, settled);
        const moved = [...after.keys()].filter(path => after.get(path) !== before.get(path)).sort();

        expect(moved).toEqual([
            "editor/notebooks/n1/notebook.json",
            "editor/notebooks/n1/pages/p9.json",
        ]);
    });
});

describe("the registry Studio itself uses", () => {
    it("has no document set in it", () => {
        // **This branch adds the layer and registers nothing in it.** The story is not chunked yet,
        // and a set registered here would change how every author's project is compared and merged
        // for the sake of a consumer that has not landed. If this ever fails, the consumer landed -
        // and the three notes in the report about what it still had to do apply.
        for (const path of [
            "editor/story/stories/s1/storydoc.json",
            "editor/brand.json",
            "editor/ui/uidoc.json",
            "editor/localization/ja.json",
        ]) {
            expect(documentSetAt(path)).toBeUndefined();
            expect(resolveDocumentSpecForPath(path)).toBeDefined();
        }
    });
});
