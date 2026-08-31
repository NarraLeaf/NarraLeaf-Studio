import {beforeEach, describe, expect, it} from "vitest";
import {DocumentStorage, loadDocument, saveDocument} from "@shared/documents/documentIo";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {TRANSFORM_PRESETS_DOCUMENT_PATH, transformPresetsSpec} from "@shared/documents/specs";
import {
    createEmptyProjectTransformPresetDocument,
    normalizeTransformPresets,
    TRANSFORM_PRESET_SCHEMA_VERSION,
    type ProjectTransformPreset,
    type ProjectTransformPresetDocument,
} from "@shared/types/transformPreset";
import {diffTransformPresets} from "./transformPresets";

/**
 * The saved transforms as a document: they round-trip, and the shapes whose only other outcome is
 * silently emptying the list are refused.
 *
 * The refusal is the one worth having. The normalizer answers an empty list for anything it cannot
 * read and the document is written back the next time a preset is saved, so a file this build does
 * not understand would otherwise become a file with nothing in it, with no error anywhere.
 */

class MemoryStorage implements DocumentStorage {
    public readonly files = new Map<string, string>();

    public read(path: string): Promise<string | null> {
        return Promise.resolve(this.files.get(path) ?? null);
    }

    public write(path: string, text: string): Promise<void> {
        this.files.set(path, text);
        return Promise.resolve();
    }

    public copy(fromPath: string, toPath: string): Promise<void> {
        const value = this.files.get(fromPath);
        if (value === undefined) {
            return Promise.reject(new Error(`no such file: ${fromPath}`));
        }
        this.files.set(toPath, value);
        return Promise.resolve();
    }
}

let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
});

const document = (presets: ProjectTransformPreset[]): ProjectTransformPresetDocument => ({
    schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION,
    presets: normalizeTransformPresets(presets),
});

describe("the transform preset document", () => {
    it("is the spec that owns editor/transform-presets.json", () => {
        expect(transformPresetsSpec.pathFor()).toBe(TRANSFORM_PRESETS_DOCUMENT_PATH);
        expect(resolveDocumentSpecForPath(TRANSFORM_PRESETS_DOCUMENT_PATH)?.spec.kind).toBe("transform-presets");
        // Windows separators reach this from the version-control side, which reports native paths.
        expect(transformPresetsSpec.matches("editor\\transform-presets.json")).toBe(true);
    });

    it("round-trips a preset with its channels and its timing", async () => {
        const saved = document([
            {
                id: "t1",
                name: "Enter from the left",
                transform: {
                    mode: "props",
                    to: {position: {xalign: 0.25, yalign: 0.5}, opacity: 1},
                    durationMs: 400,
                    easing: "easeOut",
                },
            },
            {id: "t2", name: "Shake", transform: {mode: "props", to: {rotation: 4}, repeat: 3}},
        ]);

        await saveDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH, saved);
        const result = await loadDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document).toStrictEqual(saved);
        // Already canonical on the way out, so opening a project cannot schedule a save that changes
        // only the bytes - which is a version-control change nobody made.
        expect(result.normalized).toBe(true);
    });

    it("round-trips an empty list", async () => {
        const empty = createEmptyProjectTransformPresetDocument();

        await saveDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH, empty);
        const result = await loadDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document).toStrictEqual(empty);
    });

    it("reads a list it cannot understand as corrupt rather than as no presets", async () => {
        storage.files.set(
            TRANSFORM_PRESETS_DOCUMENT_PATH,
            JSON.stringify({schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION, presets: {t1: {name: "Enter"}}}),
        );

        const result = await loadDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH);

        expect(result.status).toBe("corrupt");
    });

    it("refuses a file written by a newer Studio", async () => {
        storage.files.set(
            TRANSFORM_PRESETS_DOCUMENT_PATH,
            JSON.stringify({schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION + 1, presets: []}),
        );

        const result = await loadDocument(transformPresetsSpec, storage, TRANSFORM_PRESETS_DOCUMENT_PATH);

        expect(result.status).toBe("corrupt");
    });

    it("counts the presets, which is the whole of what a summary can say about them", () => {
        const summary = transformPresetsSpec.summarize(document([
            {id: "t1", name: "Enter", transform: {mode: "props", to: {opacity: 1}}},
        ]));

        expect(summary.counts).toEqual([{key: "transformPresets", value: 1}]);
    });
});

describe("the transform preset diff", () => {
    const base = document([
        {id: "t1", name: "Enter", transform: {mode: "props", to: {opacity: 1}}},
        {id: "t2", name: "Shake", transform: {mode: "props", to: {rotation: 4}}},
    ]);

    it("reports an arrival, a departure, a rename and a changed transform", () => {
        const head = document([
            {id: "t1", name: "Enter softly", transform: {mode: "props", to: {opacity: 1}, durationMs: 800}},
            {id: "t3", name: "Zoom", transform: {mode: "props", to: {zoom: 1.4}}},
        ]);

        const rows = diffTransformPresets(base, head, {limit: 50}).changes;

        expect(rows.map(row => row.label.key)).toEqual([
            "documentDiff.transformPresets.renamed",
            "documentDiff.transformPresets.transform",
            "documentDiff.transformPresets.removed",
            "documentDiff.transformPresets.added",
        ]);
    });

    /** The bag is compared by what it states, so a re-ordered file is not a change nobody made. */
    it("says nothing about a preset whose channels were only written in another order", () => {
        const head = document([
            {id: "t1", name: "Enter", transform: {to: {opacity: 1}, mode: "props", from: undefined}},
            {id: "t2", name: "Shake", transform: {mode: "props", to: {rotation: 4}}},
        ]);

        expect(diffTransformPresets(base, head, {limit: 50}).changes).toEqual([]);
    });
});
