import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    CONTENT_CLASS_SNIFF_BYTES,
    contentClassIsReadable,
    contentClassOf,
    contentClassOfBytes,
    extensionOf,
    resolveContentClass,
    type ContentClass,
} from "./contentClass";

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

/**
 * A real content path, copied from a real project.
 *
 * Two levels of shard and an id with no extension on the end. Every test below that could have
 * been written against `a/b.png` is written against this instead, on purpose: the defect these
 * cover survived a whole round of tests because the fixtures used a path shape the product does
 * not produce.
 */
const SHARD = "assets/content/99/55/3d15abb54213bad7203798a1adc4";

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

    it("answers unknown for the shape every asset in a real project has", () => {
        // Not a curiosity - it is the ordinary case. Studio stores an asset's contents under its
        // id, sharded two levels deep, so there is no extension anywhere to read. A classifier
        // that only reads names is therefore silent about the entire asset half of a project,
        // which is what `contentClassOfBytes` is for.
        expect(contentClassOf(SHARD)).toBe("unknown");
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

/* ---------------------------------------------------------------------------------------- */
/* Classifying by header                                                                      */
/* ---------------------------------------------------------------------------------------- */

/** Bytes as they appear at the front of a real file of each kind. */
const HEADERS: Readonly<Record<string, { bytes: number[]; expected: ContentClass }>> = {
    png: { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], expected: "bitmap" },
    // SOI, then an APP0 segment carrying "JFIF".
    jpeg: { bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], expected: "bitmap" },
    gif: { bytes: [...ascii("GIF89a"), 0x40, 0x01, 0xf0, 0x00], expected: "bitmap" },
    // RIFF, a length, and the form type - the only thing telling three formats apart.
    webp: { bytes: [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")], expected: "bitmap" },
    wav: { bytes: [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVE"), ...ascii("fmt ")], expected: "audio" },
    avi: { bytes: [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("AVI "), ...ascii("LIST")], expected: "video" },
    tiff: { bytes: [...ascii("II"), 0x2a, 0x00, 0x08, 0, 0, 0], expected: "bitmap" },
    bmp: { bytes: [...ascii("BM"), 0x36, 0x10, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0], expected: "bitmap" },
    ico: { bytes: [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20], expected: "bitmap" },
    flac: { bytes: [...ascii("fLaC"), 0x00, 0x00, 0x00, 0x22], expected: "audio" },
    ogg: { bytes: [...ascii("OggS"), 0x00, 0x02, 0, 0, 0, 0, 0, 0], expected: "audio" },
    // An MP3 that leads with a tag, and one that leads with a frame sync.
    mp3Tagged: { bytes: [...ascii("ID3"), 0x03, 0x00, 0x00, 0, 0, 0x02, 0x01], expected: "audio" },
    mp3Bare: { bytes: [0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0], expected: "audio" },
    matroska: { bytes: [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00], expected: "video" },
    truetype: { bytes: [0x00, 0x01, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x80], expected: "font" },
    opentype: { bytes: [...ascii("OTTO"), 0x00, 0x0c, 0x00, 0x80], expected: "font" },
    woff2: { bytes: [...ascii("wOF2"), 0x00, 0x01, 0x00, 0x00], expected: "font" },
    collection: { bytes: [...ascii("ttcf"), 0x00, 0x01, 0x00, 0x00, 0, 0, 0, 2, 0, 0, 0, 0x0c], expected: "font" },
    moc3: { bytes: [...ascii("MOC3"), 0x30, 0x34, 0x00, 0x00], expected: "model" },
};

/**
 * The one container that is three formats, told apart by the four bytes after `ftyp`.
 *
 * Written out rather than folded into the table above because getting this wrong is invisible:
 * an `.m4a` filed as video is handed to a reader that looks for a track box, finds none, and
 * reports nothing - which looks exactly like a file that genuinely has nothing to say.
 */
const ISO_BRANDS: Readonly<Record<string, ContentClass>> = {
    isom: "video",
    mp42: "video",
    "qt  ": "video",
    "M4V ": "video",
    "M4A ": "audio",
    avif: "bitmap",
    heic: "bitmap",
};

function ascii(text: string): number[] {
    return [...text].map((character) => character.charCodeAt(0));
}

function head(bytes: number[]): Uint8Array {
    return Uint8Array.from(bytes);
}

function isoBmff(brand: string): Uint8Array {
    return head([0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0x02, 0]);
}

describe("classifying bytes when the name says nothing", () => {
    for (const [name, { bytes, expected }] of Object.entries(HEADERS)) {
        it(`places a ${name} header as ${expected}`, () => {
            expect(contentClassOfBytes(head(bytes))).toBe(expected);
            // Through the path-shaped door as well, on the shape a real project produces: this is
            // the whole point, and asserting only the byte function would leave the two joined by
            // nothing.
            expect(resolveContentClass(SHARD, head(bytes))).toBe(expected);
        });
    }

    for (const [brand, expected] of Object.entries(ISO_BRANDS)) {
        it(`reads an ISO base media file branded "${brand}" as ${expected}`, () => {
            expect(contentClassOfBytes(isoBmff(brand))).toBe(expected);
        });
    }

    it("has no opinion about bytes it does not recognise, and says so", () => {
        // `null` and not a guess: the caller turns it back into `unknown`, which already means
        // "read this, it may be JSON under a name nobody listed" - the right answer for a format
        // nobody here can place.
        expect(contentClassOfBytes(head(ascii("QRSTUVWXYZ0123456789")))).toBeNull();
        expect(resolveContentClass(SHARD, head(ascii("QRSTUVWXYZ0123456789")))).toBe("unknown");
        // A JSON document under an extensionless name stays readable, which is what gets it parsed.
        expect(resolveContentClass(SHARD, head(ascii('{"version":2}')))).toBe("unknown");
    });

    it("refuses to answer from too few bytes rather than from part of a signature", () => {
        expect(contentClassOfBytes(head([0x89, 0x50, 0x4e]))).toBeNull();
        expect(contentClassOfBytes(head([]))).toBeNull();
    });

    it("asks for no more bytes than a caller has to promise", () => {
        // The probe's whole justification is that it costs the same for a 2 KB icon and a 200 MB
        // video, so the constant a caller reads has to be small and has to be enough. Every
        // header above is answered from a prefix of exactly that length.
        expect(CONTENT_CLASS_SNIFF_BYTES).toBeLessThanOrEqual(64);
        for (const [name, { bytes, expected }] of Object.entries(HEADERS)) {
            const clipped = head(bytes.slice(0, CONTENT_CLASS_SNIFF_BYTES));
            expect(contentClassOfBytes(clipped), name).toBe(expected);
        }
    });

    it("lets the name win wherever the name has an answer", () => {
        // A class picks a provider and the provider confirms the format from the bytes anyway, so
        // there is nothing to gain from overruling a name - and something to lose: an author's
        // `.txt` would stop being read the moment it happened to start with two of the wrong
        // bytes.
        expect(resolveContentClass("notes/todo.txt", head(HEADERS.png.bytes))).toBe("text");
        expect(resolveContentClass("assets/content/a.mp4", head(HEADERS.png.bytes))).toBe("video");
        // And with nothing to sniff, it is the name or nothing.
        expect(resolveContentClass(SHARD)).toBe("unknown");
        expect(resolveContentClass(SHARD, null)).toBe("unknown");
    });
});
