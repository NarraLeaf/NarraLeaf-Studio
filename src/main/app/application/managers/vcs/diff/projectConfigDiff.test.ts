import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentChange, DocumentDiff } from "@shared/documents/diff";
import { encodeProjectConfig, type ProjectConfigData } from "@shared/utils/nlproj";
import { pairMoves, type ContentProbe } from "./contentDiff";
import { diffDocumentBytes, specForDocumentPath } from "./documentDiff";

/**
 * The project configuration, read as itself rather than as a number of bytes.
 *
 * Every fixture here is encoded with `encodeProjectConfig` - the same function `ProjectService`
 * writes the real file with - so the test exercises the msgpack the author actually has on disk.
 * A hand-built buffer would prove that this module can decode a buffer this test wrote, which is
 * not the claim: the claim is that `<Name>.nlproj` on disk now has something to say.
 */

const PATH = "My-Game.nlproj";

function config(overrides: Partial<ProjectConfigData> = {}): ProjectConfigData {
    return {
        name: "My Game",
        identifier: "com.example.mygame",
        metadata: {
            version: "1.0.0",
            author: "Ada",
            resolution: { width: 1920, height: 1080 },
        },
        app: {
            network: { policy: "off", allowlist: [], allowHttp: false },
            localization: {
                sourceLocale: "en",
                locales: [{ code: "en", displayName: "English" }],
            },
            autoSave: { enabled: true, intervalSeconds: 5, slots: 3 },
        },
        ...overrides,
    } as ProjectConfigData;
}

const bytesOf = (value: ProjectConfigData): Buffer => Buffer.from(encodeProjectConfig(value));

function diffOf(base: ProjectConfigData, head: ProjectConfigData): DocumentDiff {
    return diffDocumentBytes({
        path: PATH,
        base: bytesOf(base),
        head: bytesOf(head),
        spec: specForDocumentPath(PATH),
    });
}

/** The row at one path, or undefined. Paths are the configuration's own structure, so they are stable. */
function rowAt(diff: DocumentDiff, path: string): DocumentChange | undefined {
    const find = (changes: readonly DocumentChange[]): DocumentChange | undefined => {
        for (const change of changes) {
            if (change.path.join("/") === path) {
                return change;
            }
            const child = find(change.children ?? []);
            if (child) {
                return child;
            }
        }
        return undefined;
    };
    return find(diff.changes);
}

describe("the project configuration diff", () => {
    it("resolves a spec for the dynamic name and for the legacy one", () => {
        expect(specForDocumentPath(PATH)?.kind).toBe("project");
        expect(specForDocumentPath("project.json")?.kind).toBe("project");
    });

    it("reads the msgpack and names the game rather than counting bytes", () => {
        const diff = diffOf(config(), config({ name: "My Better Game" }));

        expect(diff.tier).toBe("semantic");
        expect(rowAt(diff, "name")).toEqual({
            path: ["name"],
            kind: "changed",
            label: {
                key: "documentDiff.project.name",
                params: { from: "My Game", to: "My Better Game" },
            },
        });
    });

    it("says which languages the game ships in", () => {
        const before = config();
        const after = config({
            app: {
                ...before.app,
                localization: {
                    sourceLocale: "en",
                    locales: [
                        { code: "en", displayName: "English" },
                        { code: "ja", displayName: "日本語" },
                    ],
                },
            },
        });

        const diff = diffOf(before, after);

        expect(rowAt(diff, "app/localization")?.label.key).toBe("documentDiff.project.localization");
        expect(rowAt(diff, "app/localization/locales")?.label.key).toBe("documentDiff.project.locales");
        // The list is one row and carries no value pair: two lists of languages on one line cannot
        // be read at any width, which is the rule the dictionary's variant spellings follow.
        expect(rowAt(diff, "app/localization/locales")?.label.params).toBeUndefined();
    });

    it("says that automatic saving now keeps a different number of slots", () => {
        const before = config();
        const after = config({
            app: { ...before.app, autoSave: { enabled: true, intervalSeconds: 5, slots: 9 } },
        });

        const diff = diffOf(before, after);

        expect(rowAt(diff, "app/autoSave")?.label.key).toBe("documentDiff.project.autoSave");
        expect(rowAt(diff, "app/autoSave/slots")).toEqual({
            path: ["app", "autoSave", "slots"],
            kind: "changed",
            label: { key: "documentDiff.project.autoSaveSlots", params: { from: "3", to: "9" } },
        });
    });

    it("draws a window size as one pair rather than two rows", () => {
        const before = config();
        const after = config({
            metadata: { ...before.metadata, resolution: { width: 1280, height: 720 } },
        });

        expect(rowAt(diffOf(before, after), "metadata/resolution")?.label).toEqual({
            key: "documentDiff.project.metaResolution",
            params: { from: "1920×1080", to: "1280×720" },
        });
    });

    it("names a setting this build has no word for instead of dropping it", () => {
        const before = config();
        const after = config({ app: { ...before.app, somethingNewer: { mode: "loud" } } as never });

        const row = rowAt(diffOf(before, after), "app/somethingNewer");
        expect(row?.label).toEqual({ key: "documentDiff.project.field", params: { field: "somethingNewer" } });
        expect(row?.children?.[0].label).toEqual({
            key: "documentDiff.project.field",
            params: { field: "mode", to: "loud" },
        });
    });

    it("still reads the legacy project.json, which is JSON and not msgpack", () => {
        const diff = diffDocumentBytes({
            path: "project.json",
            base: Buffer.from(JSON.stringify(config()), "utf-8"),
            head: Buffer.from(JSON.stringify(config({ identifier: "com.example.renamed" })), "utf-8"),
            spec: specForDocumentPath("project.json"),
        });

        expect(diff.tier).toBe("semantic");
        expect(rowAt(diff, "identifier")?.label.params).toEqual({
            from: "com.example.mygame",
            to: "com.example.renamed",
        });
    });
});

/**
 * What renaming a project looks like, which is the one case the comparison cannot fold into a
 * single row.
 *
 * The file is named after the project, so a rename is a different file: the old name is removed
 * and the new one is added. The pairing that folds a delete and an add into one "moved" row is
 * `pairMoves`, and it matches on the content address - identical bytes under two names. A rename
 * changes the name INSIDE the file as well, so the two blobs never match and the pair is never
 * made. Both rows stand, and both are honest; whole-document add and remove carry no caveat.
 *
 * What did change is what those two rows say. `presenceDiff` parses the side it has, so each row
 * now carries the game's own name as its subject and comes back at the summary tier instead of
 * reporting a byte count at the opaque one.
 */
describe("renaming a project", () => {
    const probe = (value: ProjectConfigData): ContentProbe => {
        const bytes = bytesOf(value);
        return { size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
    };

    it("is not paired as a move, because the file's own name changed with it", () => {
        const removed = new Map([["My-Game.nlproj", probe(config())]]);
        const added = new Map([["My-Better-Game.nlproj", probe(config({ name: "My Better Game" }))]]);

        expect([...pairMoves(removed, added)]).toEqual([]);
    });

    it("reports the two halves by the game's name rather than by a byte count", () => {
        const gone = diffDocumentBytes({
            path: "My-Game.nlproj",
            base: bytesOf(config()),
            head: null,
            spec: specForDocumentPath("My-Game.nlproj"),
        });
        const arrived = diffDocumentBytes({
            path: "My-Better-Game.nlproj",
            base: null,
            head: bytesOf(config({ name: "My Better Game" })),
            spec: specForDocumentPath("My-Better-Game.nlproj"),
        });

        expect(gone.tier).toBe("summary");
        expect(gone.changes[0].kind).toBe("removed");
        expect(gone.changes[0].subject).toBe("My Game");
        expect(arrived.tier).toBe("summary");
        expect(arrived.changes[0].kind).toBe("added");
        expect(arrived.changes[0].subject).toBe("My Better Game");
    });
});
