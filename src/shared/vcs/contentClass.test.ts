import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentClassIsReadable, contentClassOf, extensionOf, type ContentClass } from "./contentClass";

/**
 * The classifier, plus the guard that stops its table drifting from the asset browser's.
 *
 * The drift guard reads `assetTypes.ts` as TEXT rather than importing it, and that is not
 * squeamishness: `contentClass.ts` lives in `shared`, whose tsconfig has no alias reaching
 * `renderer`, so an import here would not compile. Reading the source is the same technique
 * `i18n/catalog/documentDiffKeys.test.ts` uses on the diff producers, for the same reason - the
 * fact worth checking lives on the other side of a boundary the type system will not cross.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_TYPES = path.resolve(HERE, "../../renderer/lib/workspace/services/assets/assetTypes.ts");

/**
 * What each of the asset browser's types should classify as here.
 *
 * `Model` and `Other` are absent because both are `["*"]` - a model bundle is picked as a
 * directory and `Other` is anything at all, so neither names an extension to check.
 */
const EXPECTED: Readonly<Record<string, ContentClass>> = {
    Image: "bitmap",
    Audio: "audio",
    Video: "video",
    JSON: "text",
    Blueprint: "text",
    Font: "font",
};

/**
 * Extensions this file deliberately classifies differently from the asset browser.
 *
 * Every entry is a decision with a reason, and the reasons are written on the table in
 * `contentClass.ts`. A new entry here is a claim that the two tables SHOULD disagree, which is
 * a thing to argue for rather than to add quietly.
 */
const DELIBERATE: Readonly<Record<string, ContentClass>> = {
    /** XML. Filed by the browser under both image and font; it is text to a comparison. */
    svg: "text",
    /** MPEG transport stream in a file picker, TypeScript in a repository. */
    ts: "text",
};

/** The `AssetExtensions` table, read out of the renderer's source. */
function browserExtensions(): Map<string, string[]> {
    const source = fs.readFileSync(ASSET_TYPES, "utf-8");
    const table = source.slice(source.indexOf("export const AssetExtensions"));
    expect(table, "AssetExtensions not found - has assetTypes.ts moved?").not.toBe("");

    const out = new Map<string, string[]>();
    for (const block of table.matchAll(/\[AssetType\.(\w+)\]:\s*\[([\s\S]*?)\]/g)) {
        const body = block[2]
            // Line comments inside the arrays quote nothing, but they do quote words.
            .split(/\r?\n/)
            .map((line) => line.replace(/\/\/.*$/, ""))
            .join("\n");
        out.set(block[1], [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    }
    return out;
}

describe("the asset browser's extension table and this one", () => {
    const table = browserExtensions();

    it("finds the table at all", () => {
        // Guards the vacuous pass: a moved file or a tightened pattern would empty the map and
        // make every assertion below hold trivially, which is the shape of the bug this is for.
        expect([...table.keys()].sort()).toEqual(
            ["Audio", "Blueprint", "Font", "Image", "JSON", "Model", "Other", "Video"],
        );
        expect(table.get("Image")).toContain("png");
        expect(table.get("Video")).toContain("mp4");
    });

    for (const [type, expected] of Object.entries(EXPECTED)) {
        it(`classifies every ${type} extension as ${expected}`, () => {
            const wrong = (table.get(type) ?? [])
                .filter((extension) => contentClassOf(`a/b.${extension}`) !== (DELIBERATE[extension] ?? expected))
                .map((extension) => `${extension} -> ${contentClassOf(`a/b.${extension}`)}`);

            expect(
                wrong,
                `these extensions are in AssetExtensions[AssetType.${type}] and this file does not\n`
                + `agree they are "${expected}". Either add them to CLASS_OF_EXTENSION in\n`
                + "src/shared/vcs/contentClass.ts, or add them to DELIBERATE here with a reason:\n"
                + wrong.map((line) => `  ${line}`).join("\n") + "\n",
            ).toEqual([]);
        });
    }
});

describe("classifying a path", () => {
    it("reads the extension off the last segment, whichever separator is used", () => {
        expect(extensionOf("assets/content/a.PNG")).toBe("png");
        expect(extensionOf("assets\\content\\a.png")).toBe("png");
        expect(extensionOf("assets/my.folder/README")).toBe("");
        // A leading dot is a whole file name, not an extension.
        expect(extensionOf(".gitignore")).toBe("");
    });

    it("answers unknown for a name nobody listed", () => {
        expect(contentClassOf("assets/content/thing.qqq")).toBe("unknown");
        expect(contentClassOf("assets/content/thing")).toBe("unknown");
    });

    it("files a model's binaries apart from the rest of its bundle", () => {
        // A bundle's textures and manifests classify on their own; only the files Studio has
        // decided never to parse land on `model`.
        expect(contentClassOf("assets/content/hiyori/Hiyori.moc3")).toBe("model");
        expect(contentClassOf("assets/content/hiyori/Hiyori.model3.json")).toBe("text");
        expect(contentClassOf("assets/content/hiyori/texture_00.png")).toBe("bitmap");
        expect(contentClassOf("assets/content/spineboy/spineboy.skel")).toBe("model");
        expect(contentClassOf("assets/content/spineboy/spineboy.atlas")).toBe("text");
    });

    it("reads text and assets on different terms", () => {
        // The one decision the whole read plan turns on.
        expect(contentClassIsReadable(contentClassOf("editor/story.json"))).toBe(true);
        expect(contentClassIsReadable(contentClassOf("notes/todo.txt"))).toBe(true);
        // Unknown is read too: it may well be JSON under a name nobody listed.
        expect(contentClassIsReadable(contentClassOf("thing.qqq"))).toBe(true);

        expect(contentClassIsReadable(contentClassOf("assets/content/a.png"))).toBe(false);
        expect(contentClassIsReadable(contentClassOf("assets/content/a.mp3"))).toBe(false);
        expect(contentClassIsReadable(contentClassOf("assets/content/a.mp4"))).toBe(false);
        expect(contentClassIsReadable(contentClassOf("assets/content/a.ttf"))).toBe(false);
        expect(contentClassIsReadable(contentClassOf("assets/content/a.moc3"))).toBe(false);
    });
});
