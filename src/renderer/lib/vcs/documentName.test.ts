import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import {
    NO_DOCUMENT_NAMES,
    documentNameOf,
    documentNameSourcesFor,
    isAuthoredName,
    listDocumentNames,
    numberRepeatedNames,
    renderDocumentName,
    type AssetNameEntry,
    type DocumentNameContext,
} from "./documentName";
import { mergeDocumentNames, parseAnimationNames, parseAssetNames, parseStoryTitles } from "./nameSources";

const story = (id: string) => `editor/story/stories/${id}/storydoc.json`;
const context = (partial: Partial<DocumentNameContext>): DocumentNameContext => ({ ...NO_DOCUMENT_NAMES, ...partial });
const titles = (entries: Record<string, string>) => context({ storyTitles: new Map(Object.entries(entries)) });
const assets = (entries: Record<string, AssetNameEntry>) => context({ assetNames: new Map(Object.entries(entries)) });

/** Echoes the key and its parameters, so a test can see which key was chosen without a catalogue. */
const t = ((key: TranslationKey, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(",")})` : String(key)) as never;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_RUN = /[0-9a-f]{20,}/i;

/** The id the rail showed for a freshly imported picture, and the path its bytes were stored at. */
const PICTURE_ID = "f5e8519a-fdee-48e6-b064-51136de15c8e";
const PICTURE_CONTENT = "assets/content/f5/e8/519afdee48e6b06451136de15c8e";

/** Nothing any version-control surface draws may carry an id, in either spelling. */
function expectNoIdentifier(drawn: string): void {
    expect(drawn).not.toMatch(UUID);
    expect(drawn).not.toMatch(HEX_RUN);
}

describe("what the author calls a document", () => {
    it("gives a story its own title, and never the file it is stored in", () => {
        const forest = documentNameOf(story("s-1"), titles({ "s-1": "The Forest" }));
        const harbour = documentNameOf(story("s-2"), titles({ "s-2": "The Harbour" }));

        expect(forest).toEqual({ source: "authored", text: "The Forest" });
        expect(renderDocumentName(forest, t)).toBe("The Forest");
        expect(renderDocumentName(harbour, t)).toBe("The Harbour");
        for (const name of [forest, harbour]) {
            expect(renderDocumentName(name, t)).not.toContain("storydoc");
            expect(renderDocumentName(name, t)).not.toContain(".json");
        }
    });

    it("says what a story is when its title cannot be read, and never borrows its id", () => {
        // The sibling index was unreadable, absent, or past the read ceiling. Inventing a title
        // would be worse than admitting there is none - and so would printing the uuid the path is
        // made of, which the interface never shows.
        const id = "71bb159f-1322-4539-b09f-9593a426a67d";
        const name = documentNameOf(story(id), NO_DOCUMENT_NAMES);

        expect(isAuthoredName(name)).toBe(false);
        expect(name).toEqual({ source: "unnamed", key: "documentDiff.name.story" });
        expect(renderDocumentName(name, t)).toBe("documentDiff.name.story");
        expectNoIdentifier(renderDocumentName(name, t));
    });

    it("names a document that has no name of its own after its kind", () => {
        for (const path of ["editor/brand.json", "editor/variables.json", "editor/save-schema.json"]) {
            const name = documentNameOf(path, NO_DOCUMENT_NAMES);
            expect(name.source).toBe("kind");
            const drawn = renderDocumentName(name, t);
            expect(drawn).toContain("documentDiff.name.");
            expect(drawn).not.toContain(".json");
        }
    });

    it("qualifies an asset shard with the asset panel's own word for its type", () => {
        // `image` is what the FILE is called; "Images" is what the asset panel's sidebar says.
        expect(renderDocumentName(documentNameOf("assets/assets.metadata.image.json", NO_DOCUMENT_NAMES), t))
            .toBe("documentDiff.name.qualified(documentDiff.name.assetsMetadata,assets.types.image)");
        expect(renderDocumentName(documentNameOf("assets/assets.order.media.json", NO_DOCUMENT_NAMES), t))
            .toBe("documentDiff.name.qualified(documentDiff.name.assetsOrder,assets.categories.media)");
        // A folder file left behind under a TYPE's name, from before types were grouped.
        expect(renderDocumentName(documentNameOf("assets/assets.groups.audio.json", NO_DOCUMENT_NAMES), t))
            .toBe("documentDiff.name.qualified(documentDiff.name.assetsGroups,assets.types.audio)");
        // And a locale is still the locale: it is spelled the same in every language.
        expect(renderDocumentName(documentNameOf("editor/localization/zh-CN.json", NO_DOCUMENT_NAMES), t))
            .toBe("documentDiff.name.qualified(documentDiff.name.localization,zh-CN)");
    });

    it("leaves a file Studio has no concept for its whole path, not its last segment", () => {
        // Two build.js in two directories are two files, and an author has to be able to tell them
        // apart - so this is the one case where a path IS the name.
        const one = documentNameOf("scripts/a/build.js", NO_DOCUMENT_NAMES);
        const two = documentNameOf("scripts/b/build.js", NO_DOCUMENT_NAMES);

        expect(one).toEqual({ source: "file", path: "scripts/a/build.js" });
        expect(renderDocumentName(one, t)).not.toBe(renderDocumentName(two, t));
    });
});

/**
 * An asset is two files - a record in a metadata shard, and its bytes at a shard of its id - and the
 * bytes' path is the id and nothing else. This is the row the version rail used to draw as
 * "Asset file (f5e8519a-fdee-…)" for every picture an author imported.
 */
describe("what an asset's bytes are called", () => {
    it("is the asset's own name, read from its record", () => {
        const name = documentNameOf(PICTURE_CONTENT, assets({ [PICTURE_ID]: { name: "Forest Clearing.png", type: "image" } }));

        expect(name).toEqual({ source: "authored", text: "Forest Clearing.png" });
        expectNoIdentifier(renderDocumentName(name, t));
    });

    it("finds the record whatever case its key was written in", () => {
        // A shard is a plain map and may have been hand-edited; a content path is always lower case.
        const shard = JSON.stringify({ [PICTURE_ID.toUpperCase()]: { name: "Forest Clearing.png" } });
        const name = documentNameOf(PICTURE_CONTENT, context({ assetNames: parseAssetNames(shard, "image") }));

        expect(name).toEqual({ source: "authored", text: "Forest Clearing.png" });
    });

    it("is what the asset is when the record has no name, by the type the record is filed under", () => {
        const name = documentNameOf(PICTURE_CONTENT, assets({ [PICTURE_ID]: { name: "  ", type: "image" } }));

        expect(name).toEqual({ source: "unnamed", key: "documentDiff.name.assetOfType.image" });
    });

    it("is 'Asset file' when no record could be read at all - never its id", () => {
        const name = documentNameOf(PICTURE_CONTENT, NO_DOCUMENT_NAMES);

        expect(name).toEqual({ source: "unnamed", key: "documentDiff.name.assetContent" });
        expectNoIdentifier(renderDocumentName(name, t));
    });

    it("names a file inside a model bundle after the model, with its path inside the bundle", () => {
        // A bundle is stored as a folder at its id's shard; the path under it is the author's own,
        // copied verbatim from the folder they imported.
        const name = documentNameOf(
            `${PICTURE_CONTENT}/Hiyori.2048/texture_00.png`,
            assets({ [PICTURE_ID]: { name: "Hiyori", type: "model" } }),
        );

        expect(name).toEqual({ source: "authored", text: "Hiyori", within: "Hiyori.2048/texture_00.png" });
        expect(renderDocumentName(name, t)).toBe("documentDiff.name.qualified(Hiyori,Hiyori.2048/texture_00.png)");
        expectNoIdentifier(renderDocumentName(documentNameOf(`${PICTURE_CONTENT}/model3.json`, NO_DOCUMENT_NAMES), t));
    });

    it("leaves a file an author put under the content folder alone", () => {
        // A name that does not decode to an id is not an asset's bytes; it is a file.
        expect(documentNameOf("assets/content/ab/cd/notes.txt", NO_DOCUMENT_NAMES))
            .toEqual({ source: "file", path: "assets/content/ab/cd/notes.txt" });
    });
});

/**
 * A deleted asset is the case this whole read exists for twice over: its record is gone from the
 * working tree along with its bytes, so the working tree cannot name it - and the row naming it is
 * the one an author most needs to recognise before submitting a version.
 */
describe("a deleted asset keeps its name", () => {
    const shard = (records: Record<string, { name: string }>) =>
        JSON.stringify(Object.fromEntries(Object.entries(records).map(([id, record]) => [id, { id, type: "image", ...record }])));

    it("is named from the older version's record when the newer one no longer holds it", () => {
        const newer: DocumentNameContext = context({ assetNames: parseAssetNames(shard({}), "image") });
        const older: DocumentNameContext = context({
            assetNames: parseAssetNames(shard({ [PICTURE_ID]: { name: "Forest at Dusk" } }), "image"),
        });

        const name = documentNameOf(PICTURE_CONTENT, mergeDocumentNames(newer, older));

        expect(name).toEqual({ source: "authored", text: "Forest at Dusk" });
    });

    it("takes the newer name where both versions hold the asset, so a rename reads as the new name", () => {
        const newer = context({ assetNames: parseAssetNames(shard({ [PICTURE_ID]: { name: "Forest at Dusk" } }), "image") });
        const older = context({ assetNames: parseAssetNames(shard({ [PICTURE_ID]: { name: "Forest Clearing.png" } }), "image") });

        expect(renderDocumentName(documentNameOf(PICTURE_CONTENT, mergeDocumentNames(newer, older)), t))
            .toBe("Forest at Dusk");
    });

    it("keeps a deleted story's and motion's names the same way", () => {
        const newer = context({});
        const older = context({
            storyTitles: parseStoryTitles(JSON.stringify({ stories: [{ id: "s-1", name: "The Forest" }] })),
            animationNames: parseAnimationNames(JSON.stringify({ animations: [{ id: "m-1", name: "Sway" }] })),
        });
        const merged = mergeDocumentNames(newer, older);

        expect(renderDocumentName(documentNameOf(story("s-1"), merged), t)).toBe("The Forest");
        expect(renderDocumentName(documentNameOf("editor/story/animations/m-1.json", merged), t)).toBe("Sway");
    });
});

describe("reading the libraries names come from", () => {
    it("keeps a record with a blank name, because its type is still true", () => {
        const names = parseAssetNames(JSON.stringify({ [PICTURE_ID]: { name: "", type: "image" } }), "image");

        expect(names.get(PICTURE_ID)).toEqual({ name: "", type: "image" });
    });

    it("answers nothing for a library it cannot read, rather than failing the surface", () => {
        expect(parseAssetNames("not json", "image").size).toBe(0);
        expect(parseStoryTitles("{\"stories\": 3}").size).toBe(0);
        expect(parseAnimationNames("[]").size).toBe(0);
    });

    it("says which libraries a list of paths needs, so a list of scenes never reads the asset shards", () => {
        expect([...documentNameSourcesFor([story("s-1"), "editor/brand.json"])]).toEqual(["stories"]);
        expect([...documentNameSourcesFor([PICTURE_CONTENT])]).toEqual(["assets"]);
        expect([...documentNameSourcesFor(["editor/story/animations/m-1.json"])]).toEqual(["animations"]);
        expect(documentNameSourcesFor(["editor/variables.json", "scripts/a.js"]).size).toBe(0);
    });

    it("names a motion from the motion library, not from its file", () => {
        const names = context({ animationNames: new Map([["m-1", "Sway"]]) });

        expect(documentNameOf("editor/story/animations/m-1.json", names)).toEqual({ source: "authored", text: "Sway" });
        expect(documentNameOf("editor/story/animations/m-2.json", names))
            .toEqual({ source: "unnamed", key: "documentDiff.name.animation" });
        // The motion list itself is not a motion.
        expect(documentNameOf("editor/story/animations/index.json", names).source).toBe("kind");
    });
});

/**
 * Stand-ins that would read the same on one list are numbered, and nothing else is.
 *
 * This is what replaced the id as the thing that tells two unreadable stories apart: a number that
 * is a position on the list and claims nothing about the thing.
 */
describe("numbering stand-ins apart", () => {
    it("numbers two stand-ins that would read the same", () => {
        const names = numberRepeatedNames([
            documentNameOf(story("s-1"), NO_DOCUMENT_NAMES),
            documentNameOf(story("s-2"), NO_DOCUMENT_NAMES),
        ]).map(name => renderDocumentName(name, t));

        expect(names).toEqual([
            "documentDiff.name.numbered(documentDiff.name.story,1)",
            "documentDiff.name.numbered(documentDiff.name.story,2)",
        ]);
    });

    it("leaves a lone stand-in unnumbered", () => {
        const names = numberRepeatedNames([
            documentNameOf(story("s-1"), NO_DOCUMENT_NAMES),
            documentNameOf(PICTURE_CONTENT, NO_DOCUMENT_NAMES),
            documentNameOf(story("s-2"), titles({ "s-2": "The Harbour" })),
        ]).map(name => renderDocumentName(name, t));

        expect(names).toEqual(["documentDiff.name.story", "documentDiff.name.assetContent", "The Harbour"]);
    });

    it("never numbers an author's own name, even when two are the same", () => {
        // Two assets called `bg.png` are both called that. A number would be a name nobody gave.
        const bg = { name: "bg.png", type: "image" };
        const other = "11111111-1111-4111-8111-111111111111";
        const names = numberRepeatedNames([
            documentNameOf(PICTURE_CONTENT, assets({ [PICTURE_ID]: bg })),
            documentNameOf("assets/content/11/11/1111111141118111111111111111", assets({ [other]: bg })),
        ]).map(name => renderDocumentName(name, t));

        expect(names).toEqual(["bg.png", "bg.png"]);
    });
});

/**
 * The short list a notice can carry.
 *
 * The sync that ends in conflicts is what this is for, and what it is guarding is that the notice
 * and the panel it sends the author to are about the same things said the same way - the notice
 * used to print repository paths beside a panel calling the very same files by their titles.
 */
describe("listing a few documents for a notice", () => {
    const conflicts = [story("s-1"), story("s-2"), "editor/ui/uidoc.json"];

    it("lists what the author made, one per line, and no file names", () => {
        const lines = listDocumentNames(conflicts, titles({ "s-1": "The Forest", "s-2": "The Harbour" }), t, 5);

        expect(lines.split("\n")).toEqual([
            "The Forest",
            "The Harbour",
            "documentDiff.name.uiDocument",
        ]);
        expect(lines).not.toContain("storydoc");
        expect(lines).not.toContain(".json");
        expect(lines).not.toContain("editor/");
    });

    /**
     * A merge can leave hundreds of files behind and a notice is read at a glance. Truncation is
     * silent here because the sentence around it states the whole count - see `listDocumentNames`.
     */
    it("stops at the caller's limit", () => {
        const lines = listDocumentNames(conflicts, NO_DOCUMENT_NAMES, t, 2);

        expect(lines.split("\n")).toHaveLength(2);
    });

    it("still tells two unreadable titles apart, by number and never by id", () => {
        const ids = ["48bb82a5-a1c7-48d0-9a84-03c84ce46ef0", "85b21d0a-5fe6-48d1-9326-0b03b5cb7ed4"];
        const lines = listDocumentNames(ids.map(story), NO_DOCUMENT_NAMES, t, 5).split("\n");

        expect(lines[0]).not.toBe(lines[1]);
        expect(lines[0]).not.toContain("storydoc");
        lines.forEach(expectNoIdentifier);
    });
});
