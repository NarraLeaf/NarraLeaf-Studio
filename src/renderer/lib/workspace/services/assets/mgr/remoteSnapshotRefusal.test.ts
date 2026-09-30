import { describe, expect, it } from "vitest";
import { AssetExtensions, AssetType } from "../assetTypes";
import { FileFormatValidator, UNDECODABLE_EXTENSIONS } from "../FileFormatValidator";
import { remoteSnapshotRefusal } from "./remoteSnapshotRefusal";

/**
 * What a download may become, and what it is turned away as.
 *
 * The case this exists for was reproduced in the running app: an address named `page.png` that
 * answered 200 with an HTML page became an image asset, because the format check passes bytes it
 * does not recognise - which is right for a file picked from disk and wrong for whatever a server
 * chose to answer.
 */

const validator = new FileFormatValidator();

async function verdict(type: AssetType, name: string, bytes: Uint8Array, contentType?: string) {
    const validation = await validator.validateFileFormat(type, name, bytes);
    return remoteSnapshotRefusal(type, { bytes, contentType }, validation, validator)?.refusal ?? null;
}

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function bytes(...head: number[]): Uint8Array {
    const buffer = new Uint8Array(Math.max(64, head.length));
    buffer.set(head, 0);
    return buffer;
}

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0));
}

/** An ISO-BMFF `ftyp` box of 24 bytes: major brand, minor version, then one compatible brand. */
function isoBmff(major: string, compatible: string): Uint8Array {
    return bytes(0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...ascii(compatible));
}

const SIGN_IN_PAGE = text("<!DOCTYPE html>\n<html lang=\"en\"><head><title>Sign in</title></head><body></body></html>");
const PNG = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
const JPEG = bytes(0xFF, 0xD8, 0xFF, 0xE0);
const AVI = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20);
const EBML = bytes(0x1A, 0x45, 0xDF, 0xA3);
const OGG = bytes(0x4F, 0x67, 0x67, 0x53);
const ID3 = bytes(0x49, 0x44, 0x33, 0x03);
const WOFF2 = bytes(0x77, 0x4F, 0x46, 0x32);
const ICO = bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00);
const SVG = text("<?xml version=\"1.0\"?>\n<!-- Generator: an editor -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>");

describe("remoteSnapshotRefusal: a web page is not a file", () => {
    it("refuses a page served under an image name, which used to become an image asset", async () => {
        expect(await verdict(AssetType.Image, "page.png", SIGN_IN_PAGE, "text/html; charset=utf-8"))
            .toEqual({ kind: "remotePage" });
    });

    it("knows a page by its bytes when the server declares nothing, or declares a binary type", async () => {
        expect(await verdict(AssetType.Image, "cover.jpg", SIGN_IN_PAGE)).toEqual({ kind: "remotePage" });
        expect(await verdict(AssetType.Audio, "theme.mp3", text("  <html><body>Error</body></html>"), "application/octet-stream"))
            .toEqual({ kind: "remotePage" });
    });

    it("refuses a page declared as HTML whatever its bytes are", async () => {
        expect(await verdict(AssetType.Image, "cover.png", PNG, "text/html")).toEqual({ kind: "remotePage" });
        expect(await verdict(AssetType.Font, "body.woff2", WOFF2, "application/xhtml+xml")).toEqual({ kind: "remotePage" });
    });

    it("says a page before it says a name the player refuses", async () => {
        expect(await verdict(AssetType.Video, "clip.avi", SIGN_IN_PAGE, "text/html")).toEqual({ kind: "remotePage" });
    });

    it("words a page served for JSON as a page, and takes JSON however it is labelled", async () => {
        expect(await verdict(AssetType.JSON, "data.json", SIGN_IN_PAGE, "text/html")).toEqual({ kind: "remotePage" });
        expect(await verdict(AssetType.JSON, "data.json", text("{\"a\": 1}"), "text/html")).toBeNull();
        expect(await verdict(AssetType.JSON, "data.json", text("{\"a\": "), "application/json")).toEqual({ kind: "undecodable" });
    });

    it("holds no opinion about the bytes of an Other asset", async () => {
        expect(await verdict(AssetType.Other, "page.html", SIGN_IN_PAGE, "text/html")).toBeNull();
    });
});

describe("remoteSnapshotRefusal: media has to look like media of its kind", () => {
    it("refuses bytes with no image signature under an image name", async () => {
        expect(await verdict(AssetType.Image, "photo.png", bytes(1, 2, 3, 4, 5, 6), "image/png"))
            .toEqual({ kind: "remoteUnrecognized", expected: "image" });
        expect(await verdict(AssetType.Image, "photo.heic", bytes(1, 2, 3, 4), "image/heic"))
            .toEqual({ kind: "remoteUnrecognized", expected: "image" });
    });

    it("refuses a response declared as text or a document, naming the section imported into", async () => {
        expect(await verdict(AssetType.Audio, "theme.mp3", ID3, "text/plain")).toEqual({ kind: "remoteUnrecognized", expected: "media" });
        expect(await verdict(AssetType.Video, "clip.mp4", isoBmff("isom", "mp41"), "application/json"))
            .toEqual({ kind: "remoteUnrecognized", expected: "media" });
        expect(await verdict(AssetType.Font, "body.woff2", WOFF2, "text/plain")).toEqual({ kind: "remoteUnrecognized", expected: "font" });
    });

    it("says unrecognized rather than a wrong extension when the address named none", async () => {
        // No usable extension and no signature, so the name the snapshot would get has none either.
        expect(await verdict(AssetType.Image, "cover", bytes(1, 2, 3, 4), "application/octet-stream"))
            .toEqual({ kind: "remoteUnrecognized", expected: "image" });
    });

    it("keeps the conversion advice for a format the player refuses by name", async () => {
        expect(await verdict(AssetType.Video, "clip.avi", AVI, "video/x-msvideo"))
            .toMatchObject({ kind: "cannotUse", ext: "avi" });
    });

    it("keeps the mismatch for recognised bytes under another format's name", async () => {
        expect(await verdict(AssetType.Image, "photo.png", JPEG, "image/jpeg")).toEqual({ kind: "mismatch", ext: "png", actual: "JPEG" });
    });

    it("lets through media of its kind, however generically the server labels it", async () => {
        expect(await verdict(AssetType.Image, "photo.png", PNG, "image/png")).toBeNull();
        expect(await verdict(AssetType.Image, "photo.png", PNG, "application/octet-stream")).toBeNull();
        expect(await verdict(AssetType.Image, "photo.png", PNG)).toBeNull();
        // A server that labels sound as video (a common default for `.webm`) has not said "not media".
        expect(await verdict(AssetType.Audio, "theme.weba", EBML, "video/webm")).toBeNull();
    });

    it("recognises the formats the name-and-bytes check has no case for", async () => {
        expect(await verdict(AssetType.Image, "photo.avif", isoBmff("mif1", "avif"), "image/avif")).toBeNull();
        expect(await verdict(AssetType.Image, "favicon.ico", ICO, "image/x-icon")).toBeNull();
        expect(await verdict(AssetType.Audio, "theme.mka", EBML)).toBeNull();
        expect(await verdict(AssetType.Video, "clip.ogv", OGG, "video/ogg")).toBeNull();
        expect(await verdict(AssetType.Video, "clip.mov", bytes(0, 0, 0, 8, ...ascii("wide")), "video/quicktime")).toBeNull();
    });

    it("takes an SVG labelled as text, which is how hosts serving files verbatim label it", async () => {
        expect(await verdict(AssetType.Image, "logo.svg", SVG, "text/plain; charset=utf-8")).toBeNull();
        expect(await verdict(AssetType.Image, "logo.svg", SVG, "image/svg+xml")).toBeNull();
        expect(await verdict(AssetType.Image, "logo.svg", text("<html><body><svg></svg></body></html>"), "text/plain"))
            .toEqual({ kind: "remotePage" });
    });
});

describe("FileFormatValidator.recognizes", () => {
    /** One sample per format each media type takes, by extension. */
    const SAMPLES: Partial<Record<AssetType, Record<string, Uint8Array>>> = {
        [AssetType.Image]: {
            png: PNG, apng: PNG, jpg: JPEG, gif: bytes(...ascii("GIF89a")), webp: bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")),
            bmp: bytes(...ascii("BM")), ico: ICO, cur: bytes(0x00, 0x00, 0x02, 0x00, 0x01, 0x00),
            avif: isoBmff("avif", "mif1"), svg: SVG,
        },
        [AssetType.Audio]: {
            mp3: ID3, wav: bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")), ogg: OGG, opus: OGG,
            flac: bytes(...ascii("fLaC")), aac: bytes(0xFF, 0xF1, 0x50, 0x80), m4a: isoBmff("M4A ", "isom"),
            weba: EBML, mka: EBML,
        },
        [AssetType.Video]: {
            mp4: isoBmff("isom", "mp41"), m4v: isoBmff("M4V ", "isom"), mov: isoBmff("qt  ", "qt  "),
            "3gp": isoBmff("3gp4", "isom"), webm: EBML, mkv: EBML, ogv: OGG,
        },
        [AssetType.Font]: {
            ttf: bytes(0x00, 0x01, 0x00, 0x00), otf: bytes(...ascii("OTTO")), woff: bytes(...ascii("wOFF")), woff2: WOFF2,
        },
    };

    /** Extensions that name a sampled format under another name, and so share its signature. */
    const ALIASES: Record<string, string> = {
        jpeg: "jpg", jpe: "jpg", jfif: "jpg", pjpeg: "jpg", pjp: "jpg", dib: "bmp", wave: "wav", oga: "ogg",
        m4b: "mp4", m4r: "mp4", qt: "mov", "3g2": "3gp", f4v: "mp4", ogm: "ogv", ogx: "ogv",
    };

    /**
     * A format a media type takes with no signature here is a format no URL can serve, so every one
     * the extension gate lets through needs a sample. The ones it refuses by name never reach this
     * check under their own name.
     */
    it("has a signature for every format a media type takes and the player can use", () => {
        for (const type of [AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.Font]) {
            const samples = SAMPLES[type] ?? {};
            for (const extension of AssetExtensions[type]) {
                if (UNDECODABLE_EXTENSIONS[type]?.[extension]) {
                    continue;
                }
                const sample = samples[extension] ?? samples[ALIASES[extension] ?? ""];
                expect(sample, `a sample for ${type} .${extension}`).toBeDefined();
                expect(validator.recognizes(type, sample!), `${type} .${extension}`).toBe(true);
            }
        }
    });

    it("recognises none of them in a web page, plain text or zeros", () => {
        for (const type of [AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.Font]) {
            expect(validator.recognizes(type, SIGN_IN_PAGE), type).toBe(false);
            expect(validator.recognizes(type, text("Access denied.")), type).toBe(false);
            expect(validator.recognizes(type, new Uint8Array(64)), type).toBe(false);
            expect(validator.recognizes(type, new Uint8Array(0)), type).toBe(false);
        }
    });
});
