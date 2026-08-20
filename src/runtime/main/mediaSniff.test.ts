import { describe, expect, it } from "vitest";
import { mediaTypeOf, sniffMediaType } from "./mediaSniff";

/** A header with `signature` at the front, padded so length checks behave like a real file. */
function file(signature: number[] | string, ...rest: (number[] | string)[]): Buffer {
    const parts = [signature, ...rest].map(part => (
        typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part)
    ));
    return Buffer.concat([...parts, Buffer.alloc(64)]);
}

describe("sniffMediaType", () => {
    it("names the image formats a game ships", () => {
        expect(sniffMediaType(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
        expect(sniffMediaType(file([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
        expect(sniffMediaType(file("GIF89a"))).toBe("image/gif");
        expect(sniffMediaType(file("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("image/webp");
    });

    it("separates the two RIFF payloads by their form type rather than by their magic", () => {
        // Both start `RIFF`; serving a wav as an image is the failure this guards.
        expect(sniffMediaType(file("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("audio/wav");
        expect(sniffMediaType(file("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("image/webp");
    });

    it("names audio containers, including the ones that share a magic with video", () => {
        expect(sniffMediaType(file("ID3"))).toBe("audio/mpeg");
        expect(sniffMediaType(file([0xff, 0xfb]))).toBe("audio/mpeg");
        expect(sniffMediaType(file("fLaC"))).toBe("audio/flac");
        expect(sniffMediaType(file("OggS"))).toBe("audio/ogg");
        // `ftyp` alone does not say which; the major brand does.
        expect(sniffMediaType(file([0, 0, 0, 0x20], "ftyp", "M4A "))).toBe("audio/mp4");
        expect(sniffMediaType(file([0, 0, 0, 0x20], "ftyp", "isom"))).toBe("video/mp4");
    });

    it("names video containers", () => {
        expect(sniffMediaType(file([0x1a, 0x45, 0xdf, 0xa3], "\x42\x82", "webm"))).toBe("video/webm");
    });

    it("names the font formats a font asset can be", () => {
        expect(sniffMediaType(file("wOFF"))).toBe("font/woff");
        expect(sniffMediaType(file("wOF2"))).toBe("font/woff2");
        expect(sniffMediaType(file("OTTO"))).toBe("font/otf");
        expect(sniffMediaType(file([0x00, 0x01, 0x00, 0x00]))).toBe("font/ttf");
    });

    it("reads an SVG whose element is pushed past the front by a declaration and a doctype", () => {
        const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
            + '<svg xmlns="http://www.w3.org/2000/svg"/>';
        expect(sniffMediaType(Buffer.from(svg, "utf-8"))).toBe("image/svg+xml");
    });

    it("survives a UTF-8 BOM in front of a text payload", () => {
        // The prefix is decoded as latin1, so a BOM arrives as three bytes rather than as U+FEFF.
        expect(sniffMediaType(Buffer.from("﻿{\"Version\":3}", "utf-8"))).toBe("application/json");
    });

    it("answers null for bytes it does not recognise, and never guesses", () => {
        expect(sniffMediaType(Buffer.from([0x4d, 0x4f, 0x43, 0x33]))).toBeNull();
        expect(sniffMediaType(Buffer.alloc(0))).toBeNull();
    });

    it("falls back to octet-stream only where a caller must name something", () => {
        expect(mediaTypeOf(Buffer.from([0x4d, 0x4f, 0x43, 0x33]))).toBe("application/octet-stream");
        expect(mediaTypeOf(file("GIF87a"))).toBe("image/gif");
    });
});
