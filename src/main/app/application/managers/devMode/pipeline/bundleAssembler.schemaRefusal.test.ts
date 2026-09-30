import os from "os";
import path from "path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { CHARACTER_STORE_VERSION } from "@shared/characters/characterStoreModel";
import { findProjectDocumentTooNewError, type ProjectDocumentKind } from "@shared/documents/newerSchema";
import { ASSET_SET_SCHEMA_VERSION } from "@shared/types/assetSet";
import { AUDIO_TRACK_SCHEMA_VERSION } from "@shared/types/audioTrack";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BRAND_SCHEMA_VERSION } from "@shared/types/brand";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION, LOCALIZATION_KEYS_SCHEMA_VERSION } from "@shared/types/localization";
import { SAVE_SCHEMA_VERSION } from "@shared/types/saveSchema";
import {
    STORY_ANIMATION_SCHEMA_VERSION,
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
} from "@shared/types/story";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { VARIABLE_REGISTRY_SCHEMA_VERSION } from "@shared/types/variables/registry";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import { assembleDevModeBundleFromProjectPath } from "./bundleAssembler";

/**
 * What the main process does with a project file a newer Studio wrote.
 *
 * This assembly is the only reader between the files on disk and a running game: Dev Mode, the
 * preview and every build come through it, and none of them goes through the renderer's document
 * services or their schema guards. So a document from the future reaching here is read by
 * normalizers that were written to be forgiving - each one drops the fields it does not recognise
 * and returns something valid-looking - and the result is a game that plays with part of the
 * author's work missing and nothing anywhere saying so. A build that stops is the better outcome,
 * and the table below is the list of files that can now stop one.
 *
 * Every case is the same project with one number changed, which is the point: the refusal is not a
 * special case for the documents somebody happened to think of.
 */

const STORY_ID = "b7fbe8a2-4f75-4a55-a4a6-4a4b9c8e5f01";
const ANIMATION_ID = "a1b2c3d4-1111-2222-3333-444455556666";

type RefusalCase = {
    /** What the sentence should call this file. */
    kind: ProjectDocumentKind;
    /** Project-relative path, for the write and for the assertion on the subject. */
    file: string;
    /** The version this build reads; the fixture is written one above it. */
    supported: number;
    /** What a refusal names this file: its path, or a story's own name. */
    subject: string;
};

const CASES: RefusalCase[] = [
    { kind: "uiDocument", file: "editor/ui/uidoc.json", supported: UI_DOCUMENT_SCHEMA_VERSION, subject: "editor/ui/uidoc.json" },
    { kind: "uiGraphs", file: "editor/ui/uigraphs.json", supported: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, subject: "editor/ui/uigraphs.json" },
    { kind: "storyIndex", file: "editor/story/index.json", supported: STORY_LIBRARY_INDEX_SCHEMA_VERSION, subject: "editor/story/index.json" },
    // Named by the story's own name: its path is made of an id, and an id says nothing to an author.
    { kind: "story", file: `editor/story/stories/${STORY_ID}/storydoc.json`, supported: STORY_DOCUMENT_SCHEMA_VERSION, subject: "Story" },
    { kind: "storyAnimation", file: "editor/story/animations/index.json", supported: STORY_ANIMATION_SCHEMA_VERSION, subject: "editor/story/animations/index.json" },
    { kind: "variables", file: "editor/variables.json", supported: VARIABLE_REGISTRY_SCHEMA_VERSION, subject: "editor/variables.json" },
    { kind: "saveSchema", file: "editor/save-schema.json", supported: SAVE_SCHEMA_VERSION, subject: "editor/save-schema.json" },
    { kind: "assetSets", file: "editor/asset-sets.json", supported: ASSET_SET_SCHEMA_VERSION, subject: "editor/asset-sets.json" },
    { kind: "audioTracks", file: "editor/audio-tracks.json", supported: AUDIO_TRACK_SCHEMA_VERSION, subject: "editor/audio-tracks.json" },
    { kind: "localization", file: "editor/localization/ja.json", supported: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, subject: "editor/localization/ja.json" },
    { kind: "localizationKeys", file: "editor/localization/keys.json", supported: LOCALIZATION_KEYS_SCHEMA_VERSION, subject: "editor/localization/keys.json" },
    { kind: "voice", file: "editor/voice/ja.json", supported: VOICE_DOCUMENT_SCHEMA_VERSION, subject: "editor/voice/ja.json" },
    { kind: "brand", file: "editor/brand.json", supported: BRAND_SCHEMA_VERSION, subject: "editor/brand.json" },
];

describe("bundleAssembler and a project file from a newer Studio", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function write(projectPath: string, file: string, value: unknown): Promise<void> {
        const target = path.join(projectPath, ...file.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(value, null, 2), "utf-8");
    }

    /**
     * A project holding one of everything, all at the versions this build writes.
     *
     * Complete rather than minimal because most of these loaders are only reached when the document
     * above them read: the voice tables are read from the locales the `.nlproj` declares, and the
     * localization keys only after the tables.
     */
    async function createProject(): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-schema-refusal-"));
        tempDirs.push(projectPath);
        await writeFile(
            path.join(projectPath, "project.nlproj"),
            encodeProjectConfig({
                name: "Test",
                identifier: "test.project",
                metadata: {},
                app: {
                    localization: {
                        sourceLocale: "en",
                        locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
                    },
                    voice: { voicedLocales: [{ code: "ja", displayName: "日本語" }] },
                },
            } as never),
        );
        await write(projectPath, "editor/ui/uidoc.json", { schemaVersion: UI_DOCUMENT_SCHEMA_VERSION, surfaces: [] });
        await write(projectPath, "editor/ui/uigraphs.json", {
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {} },
        });
        await write(projectPath, "editor/story/index.json", {
            schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
            stories: [{ id: STORY_ID, name: "Story" }],
        });
        await write(projectPath, `editor/story/stories/${STORY_ID}/storydoc.json`, {
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
            id: STORY_ID,
            name: "Story",
            chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
            scenes: {
                "scene-1": { id: "scene-1", name: "Scene 1", runtimeName: "Scene 1", rootBlockIds: [], blocks: {} },
            },
        });
        await write(projectPath, "editor/story/animations/index.json", {
            schemaVersion: STORY_ANIMATION_SCHEMA_VERSION,
            animations: [{ id: ANIMATION_ID, name: "Fade" }],
        });
        await write(projectPath, "editor/variables.json", { schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries: {} });
        await write(projectPath, "editor/save-schema.json", { schemaVersion: SAVE_SCHEMA_VERSION, fields: {} });
        await write(projectPath, "editor/asset-sets.json", { schemaVersion: ASSET_SET_SCHEMA_VERSION, sets: {} });
        await write(projectPath, "editor/audio-tracks.json", { schemaVersion: AUDIO_TRACK_SCHEMA_VERSION, tracks: [] });
        await write(projectPath, "editor/localization/ja.json", { schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale: "ja", units: {} });
        await write(projectPath, "editor/localization/keys.json", { schemaVersion: LOCALIZATION_KEYS_SCHEMA_VERSION, keys: {} });
        await write(projectPath, "editor/voice/ja.json", { schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale: "ja", units: {} });
        await write(projectPath, "editor/brand.json", { schemaVersion: BRAND_SCHEMA_VERSION, colors: [], fonts: [] });
        await write(projectPath, "editor/services/character.json", { version: CHARACTER_STORE_VERSION, characters: [] });
        return projectPath;
    }

    function assemble(projectPath: string, locale?: "en" | "zh" | "ja") {
        return assembleDevModeBundleFromProjectPath({
            projectPath,
            bundleId: "bundle-1",
            revision: 1,
            ...(locale ? { locale } : {}),
        });
    }

    it("assembles a project whose every document is at this build's version", async () => {
        const bundle = await assemble(await createProject());

        expect(bundle.storyLibrary?.documents[STORY_ID]?.id).toBe(STORY_ID);
    });

    it.each(CASES)("refuses a newer $kind and names it", async testCase => {
        const projectPath = await createProject();
        const target = path.join(projectPath, ...testCase.file.split("/"));
        const before = JSON.parse(await readFile(target, "utf-8")) as Record<string, unknown>;
        const versionField = testCase.kind === "characters" ? "version" : "schemaVersion";
        await write(projectPath, testCase.file, { ...before, [versionField]: testCase.supported + 1 });
        const bytesBefore = (await stat(target)).size;

        const failure = await assemble(projectPath, "en").then(() => null, (error: unknown) => error);

        expect(failure).not.toBeNull();
        const message = (failure as Error).message;
        expect(message).toContain(testCase.subject);
        expect(message).toContain(`v${testCase.supported + 1}`);
        expect(message).toContain(`v${testCase.supported}`);
        // The value survives the sentence, so a caller with a different language still has the facts.
        const refusal = findProjectDocumentTooNewError(failure);
        expect(refusal?.kind).toBe(testCase.kind);
        expect(refusal?.version).toBe(testCase.supported + 1);
        // And the file is exactly as the author left it. A read that rewrote what it refused would
        // be the very failure this exists to prevent, one step later.
        expect((await stat(target)).size).toBe(bytesBefore);
    });

    it("refuses a blueprint record from the future even though its wrapper is current", async () => {
        const projectPath = await createProject();
        await write(projectPath, "editor/ui/uigraphs.json", {
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION + 1, blueprints: {} },
        });

        const failure = await assemble(projectPath, "en").then(() => null, (error: unknown) => error);

        // The wrapper has sat at 2 while the record inside it reached double figures, so the version
        // that moves is the inner one - and it is the one whose refusal has to name a newer Studio
        // rather than the oldest this build opens.
        expect(findProjectDocumentTooNewError(failure)?.kind).toBe("blueprints");
        expect((failure as Error).message).toContain("newer");
    });

    it("refuses a character store from the future, which versions itself under another name", async () => {
        const projectPath = await createProject();
        await write(projectPath, "editor/services/character.json", {
            version: CHARACTER_STORE_VERSION + 1,
            characters: [],
        });

        const failure = await assemble(projectPath, "en").then(() => null, (error: unknown) => error);

        expect(findProjectDocumentTooNewError(failure)?.kind).toBe("characters");
    });

    it("says it in the language the host asked in", async () => {
        const projectPath = await createProject();
        await write(projectPath, "editor/brand.json", { schemaVersion: BRAND_SCHEMA_VERSION + 1, colors: [] });

        const failure = await assemble(projectPath, "zh").then(() => null, (error: unknown) => error);

        expect((failure as Error).message).toContain("设计");
    });
});
