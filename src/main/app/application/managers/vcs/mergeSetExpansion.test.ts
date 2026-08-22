import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { notebookLookup } from "@shared/documents/__fixtures__/syntheticDocumentSet";
import { documentSetAt } from "@shared/documents/documentSet";
import { expandDocumentSets } from "./merge";

/**
 * Which paths a settle is actually given, when one document is several files.
 *
 * **The case this file exists for is data-losing and silent.** Settling a set change by change can
 * DELETE a member the author decided against keeping, and the conflicted-path walk requires the
 * conflicted file to be on disk - so the one path that most needs settling is the one the walk can
 * no longer see. Left out of the resolve verb, it stays in conflict, the commit is refused naming
 * it, and by then the members that did settle have lost their sidecars to the failed commit's
 * stage (docs §4.32). There is no way back from that by retrying.
 *
 * No backend here: expansion is `fs` plus the registry, and driving it through `resolveConflicts`
 * would need a repository just to observe a list.
 */

const MANIFEST = "editor/notebooks/n1/notebook.json";
const roots: string[] = [];

function tmp(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-expand-")));
    roots.push(root);
    return root;
}

function write(root: string, relative: string, contents = "{}"): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf-8");
}

/** A conflicted file exactly as a merge leaves it: markers in it, three copies beside it. */
function conflicted(root: string, relative: string): void {
    write(root, relative, "<<<<<<< ours");
    write(root, `${relative}~base`, "{}");
    write(root, `${relative}~mine`, "{}");
    write(root, `${relative}~theirs`, "{}");
}

const page = (id: string): string => `editor/notebooks/n1/pages/${id}.json`;

afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("expanding a settle over a document that is several files", () => {
    it("keeps a member whose file the settle deleted, because its sidecars are still there", async () => {
        // The whole point. `writeDocumentSet` removed `p2` because the side the author took no
        // longer holds that page, and left its sidecars alone for the commit to clear. The walk
        // cannot see it - `findConflictedPaths` requires the subject file - so only the incoming
        // list knows about it, and dropping the incoming list loses it.
        const root = tmp();
        write(root, MANIFEST);
        conflicted(root, page("p1"));
        conflicted(root, page("p2"));
        fs.rmSync(path.join(root, page("p2")));

        const expanded = await expandDocumentSets(root, [page("p1"), page("p2")], notebookLookup);

        expect([...expanded].sort()).toEqual([page("p1"), page("p2")]);
    });

    it("adds the document's other conflicted members to whichever one it was handed", async () => {
        const root = tmp();
        write(root, MANIFEST);
        conflicted(root, page("p1"));
        conflicted(root, page("p2"));

        const expanded = await expandDocumentSets(root, [page("p1")], notebookLookup);

        expect([...expanded].sort()).toEqual([page("p1"), page("p2")]);
    });

    it("drops a set path the merge never touched, so taking a side cannot fail on it", async () => {
        // A folded surface names a set by its MANIFEST, and a manifest that automerged cleanly has
        // no sidecars beside it. Keeping it would hand `takeSide` a path with no `~mine` to copy,
        // and "keep mine" would throw on every set whose manifest was not itself in conflict.
        const root = tmp();
        write(root, MANIFEST);
        conflicted(root, page("p1"));

        const expanded = await expandDocumentSets(root, [MANIFEST], notebookLookup);

        expect([...expanded]).toEqual([page("p1")]);
    });

    it("leaves a list with no set path in it exactly as it arrived, and walks nothing", async () => {
        // The only case that happens today: no document set is registered, so this must be the
        // identity - including for paths that do not exist at all.
        const root = tmp();

        const expanded = await expandDocumentSets(root, ["editor/brand.json", "assets/a/b/c"], documentSetAt);

        expect(expanded).toEqual(["editor/brand.json", "assets/a/b/c"]);
    });

    it("does not pull in a different document's conflicts", async () => {
        const root = tmp();
        write(root, MANIFEST);
        conflicted(root, page("p1"));
        write(root, "editor/notebooks/n2/notebook.json");
        conflicted(root, "editor/notebooks/n2/pages/p1.json");

        const expanded = await expandDocumentSets(root, [page("p1")], notebookLookup);

        expect([...expanded]).toEqual([page("p1")]);
    });
});
