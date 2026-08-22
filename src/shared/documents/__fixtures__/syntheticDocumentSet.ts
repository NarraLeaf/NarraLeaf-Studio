import {buildDocumentDiff, type DocumentChange, type DocumentMergeDecision} from "../diff";
import {
    defineDocumentSetSpec,
    documentSetLookupOver,
    type DocumentSetLookup,
    type DocumentSetParts,
    type DocumentSetSpec,
} from "../documentSet";
import {mergeKeyed} from "../specs/mergeHelpers";
import type {DocumentKind, DocumentParseContext} from "../types";

/**
 * A document set that exists only for tests, and deliberately resembles the story document.
 *
 * **Nothing registers it.** The layer it exercises has to be proven before the story is split into
 * one file per scene, and a set registered here would be a set registered in every author's
 * project: a defect in this code would then reach their files on the next pull, for the sake of a
 * consumer that has not landed. So the proof runs against a shape that has the properties that make
 * the story hard - a manifest whose members are keyed by id, an order the manifest owns and the
 * members do not, and a whole-document `merge3` - and against nothing that ships.
 *
 * A notebook: `notebook.json` holds the title and the page order, `pages/<pageId>.json` holds one
 * page's lines. The assembled document is what a format's `diff`, `merge3` and `summarize` see, and
 * it is the shape neither file has on its own.
 */

export const NOTEBOOK_MANIFEST_PATH = "editor/notebooks/<notebookId>/notebook.json";
export const NOTEBOOK_MEMBER_PATH = "editor/notebooks/<notebookId>/pages/<pageId>.json";

export interface NotebookPage {
    readonly title: string;
    readonly lines: readonly string[];
}

export interface NotebookDocument {
    readonly schemaVersion: number;
    readonly id: string;
    readonly title: string;
    /** The manifest's own field: the order pages are read in, which no page file knows. */
    readonly pageOrder: readonly string[];
    readonly pages: Readonly<Record<string, NotebookPage>>;
}

export const NOTEBOOK_SCHEMA_VERSION = 3;

/**
 * The kind is cast because it is not one.
 *
 * `DocumentKind` is a closed union so that a typo cannot register a spec nobody looks up, and this
 * fixture is exactly the case that rule has no room for: a format that must resolve, diff and merge
 * like a real one without being one. Widening the product union for a test would put a phantom
 * document format in front of every reader of `types.ts`, which is worse than one cast that says
 * what it is doing.
 */
const NOTEBOOK_KIND = "test-notebook" as unknown as DocumentKind;

export const notebookSpec: DocumentSetSpec<NotebookDocument> = defineDocumentSetSpec<NotebookDocument>({
    kind: NOTEBOOK_KIND,
    version: NOTEBOOK_SCHEMA_VERSION,
    manifestPath: NOTEBOOK_MANIFEST_PATH,
    memberPath: NOTEBOOK_MEMBER_PATH,

    /**
     * Fold the files that were found, and let the manifest's order be advisory.
     *
     * Both halves are the fixture's answer to rule 1 of `documentSet.ts` - members are enumerated by
     * path - and both are shapes a real project produces. An id in `pageOrder` with no file is what
     * a half-finished pull looks like, and a file no order mentions is what a merge that took one
     * side of the manifest and the other side of a page leaves behind. Dropping the first and
     * appending the second keeps `assemble` total; a format that would rather refuse says so with
     * `context.corrupt`, which is why the context is passed.
     */
    assemble: (parts: DocumentSetParts, context: DocumentParseContext) => {
        const manifest = parts.manifest;
        if (!isRecord(manifest)) {
            return context.corrupt("the manifest is not an object");
        }
        const declared = Array.isArray(manifest.pageOrder) ? manifest.pageOrder.filter(isString) : [];
        const present = declared.filter(id => parts.members.has(id));
        const extra = [...parts.members.keys()].filter(id => !present.includes(id)).sort();
        return {
            ...manifest,
            pageOrder: [...present, ...extra],
            pages: Object.fromEntries([...present, ...extra].map(id => [id, parts.members.get(id)])),
        };
    },

    disassemble: (document: NotebookDocument): DocumentSetParts => {
        const {pages, ...manifest} = document;
        return {
            manifest: {...manifest, pageOrder: [...document.pageOrder]},
            members: new Map(Object.entries(pages)),
        };
    },

    parse: (raw, context) => {
        if (!isRecord(raw)) {
            return context.corrupt("a notebook must be an object");
        }
        if (typeof raw.schemaVersion === "number" && raw.schemaVersion > NOTEBOOK_SCHEMA_VERSION) {
            return context.corrupt(`written by a newer build (v${raw.schemaVersion})`);
        }
        const pages: Record<string, NotebookPage> = {};
        for (const [id, page] of Object.entries(isRecord(raw.pages) ? raw.pages : {})) {
            if (!isRecord(page)) {
                return context.corrupt(`page "${id}" is not an object`);
            }
            pages[id] = {
                title: isString(page.title) ? page.title : "",
                lines: Array.isArray(page.lines) ? page.lines.filter(isString) : [],
            };
        }
        // **`pageOrder` is a permutation of `pages`' keys on the way out**, which is what makes
        // `parse(assemble(disassemble(x)))` an identity rather than nearly one: `assemble` appends
        // a member no order mentions, so a parse that left such a page out of the order would
        // produce a document that changed the second time it went round.
        const declared = (Array.isArray(raw.pageOrder) ? raw.pageOrder.filter(isString) : [])
            .filter(id => id in pages);
        return {
            schemaVersion: NOTEBOOK_SCHEMA_VERSION,
            id: isString(raw.id) ? raw.id : "",
            title: isString(raw.title) ? raw.title : "",
            pageOrder: [...declared, ...Object.keys(pages).filter(id => !declared.includes(id))],
            pages,
        };
    },

    summarize: document => ({
        title: document.title,
        counts: [
            {key: "notebookPages", value: Object.keys(document.pages).length},
            {key: "notebookLines", value: Object.values(document.pages).reduce((total, page) => total + page.lines.length, 0)},
        ],
    }),

    /**
     * A whole-document diff, which is the property the whole layer exists to preserve.
     *
     * It reads `pageOrder` - a manifest field - to rank pages whose contents live in other files,
     * so it cannot be computed from any one file. That is `diffStoryDocument`'s situation in
     * miniature.
     */
    diff: (base, head, options) => {
        const changes: DocumentChange[] = [];
        const rank = (id: string) => {
            const index = head.pageOrder.indexOf(id);
            return index < 0 ? head.pageOrder.length + base.pageOrder.indexOf(id) : index;
        };
        for (const id of [...new Set([...Object.keys(base.pages), ...Object.keys(head.pages)])]) {
            const before = base.pages[id];
            const after = head.pages[id];
            if (before && after && before.lines.length === after.lines.length && before.title === after.title) {
                continue;
            }
            changes.push({
                path: ["pages", id],
                kind: !before ? "added" : !after ? "removed" : "changed",
                label: {key: "test.notebook.page", params: {lines: (after ?? before).lines.length}},
                subject: (after ?? before).title,
            });
        }
        if (base.title !== head.title) {
            changes.push({path: ["title"], kind: "changed", label: {key: "test.notebook.title"}, subject: head.title});
        }
        changes.sort((a, b) => rank(a.path[1] ?? "") - rank(b.path[1] ?? ""));
        return buildDocumentDiff(changes, {tier: "semantic", limit: options.limit});
    },

    /** One decision per page, addressed exactly as the diff addresses one: `["pages", id]`. */
    merge3: (base, mine, theirs) => {
        const result = mergeKeyed<NotebookPage>(base?.pages, mine.pages, theirs.pages);
        const decisions: DocumentMergeDecision[] = result.rows.map(row => ({
            path: ["pages", row.key],
            outcome: row.outcome,
            label: {key: "test.notebook.page"},
            subject: (row.mine.value as NotebookPage | undefined)?.title
                ?? (row.theirs.value as NotebookPage | undefined)?.title
                ?? row.key,
            mine: row.mine,
            theirs: row.theirs,
        }));
        const pages = result.merged;
        return {
            document: {
                ...mine,
                // Mine's order, then anything only theirs has. The manifest is merged as crudely as
                // a fixture may be; what is under test is that the decision list is whole-document.
                pageOrder: [
                    ...mine.pageOrder.filter(id => id in pages),
                    ...Object.keys(pages).filter(id => !mine.pageOrder.includes(id)),
                ],
                pages,
            },
            decisions,
            conflicts: decisions.filter(decision => decision.outcome === "conflict").length,
        };
    },
});

/** A lookup over the fixture alone, for a caller that must not touch the registry Studio uses. */
export const notebookLookup: DocumentSetLookup = documentSetLookupOver([notebookSpec]);

export function notebookManifestPath(notebookId: string): string {
    return notebookSpec.pathFor({notebookId});
}

export function notebookPagePath(notebookId: string, pageId: string): string {
    return notebookSpec.pathFor({notebookId, pageId});
}

/** The manifest a notebook of these pages would be stored as. */
export function notebookManifest(options: {
    id: string;
    title?: string;
    pageOrder: readonly string[];
}): Record<string, unknown> {
    return {
        schemaVersion: NOTEBOOK_SCHEMA_VERSION,
        id: options.id,
        title: options.title ?? options.id,
        pageOrder: [...options.pageOrder],
    };
}

export function notebookPage(title: string, lines: readonly string[]): NotebookPage {
    return {title, lines: [...lines]};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}
