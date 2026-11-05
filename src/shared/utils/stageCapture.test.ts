/**
 * A save's picture read back from the compositor, in the one place both main processes read it.
 *
 * Electron is a stand-in: what is pinned is the area asked for, the size the picture is kept at,
 * the encoding, and that every way of not getting a frame answers null for the page to fall back on.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import {
    captureStageThumbnail,
    normalizeStageCaptureRequest,
    stageCaptureArea,
    type StageCaptureContents,
    type StageCaptureImage,
    type StageCaptureRect,
} from "./stageCapture";

function fakeImage(width: number, height: number, log: string[], empty = false): StageCaptureImage {
    return {
        isEmpty: () => empty,
        getSize: () => ({ width, height }),
        resize: options => {
            log.push(`resize ${JSON.stringify(options)}`);
            const w = options.width ?? Math.round(width * (options.height! / height));
            const h = options.height ?? Math.round(height * (options.width! / width));
            return fakeImage(w, h, log);
        },
        toJPEG: quality => {
            log.push(`jpeg ${quality} ${width}x${height}`);
            return { toString: () => "SlBFRw==" };
        },
    };
}

function fakeContents(image: Promise<StageCaptureImage>, zoom = 1) {
    const asked: Array<StageCaptureRect | undefined> = [];
    const contents: StageCaptureContents = {
        capturePage: rect => {
            asked.push(rect);
            return image;
        },
        getZoomFactor: () => zoom,
    };
    return { contents, asked };
}

const REQUEST = { rect: { x: 0, y: 40, width: 1400, height: 787.5 }, maxEdge: 960, quality: 0.85 };

describe("normalizeStageCaptureRequest", () => {
    it("accepts a finite request and clamps the quality", () => {
        expect(normalizeStageCaptureRequest({ ...REQUEST, quality: 3 })).toEqual({ ...REQUEST, quality: 1 });
    });

    it("refuses anything else", () => {
        expect(normalizeStageCaptureRequest(null)).toBeNull();
        expect(normalizeStageCaptureRequest({ ...REQUEST, rect: { x: 0, y: 0, width: 0, height: 10 } })).toBeNull();
        expect(normalizeStageCaptureRequest({ ...REQUEST, rect: { x: "0", y: 0, width: 10, height: 10 } })).toBeNull();
        expect(normalizeStageCaptureRequest({ ...REQUEST, maxEdge: Number.NaN })).toBeNull();
        expect(normalizeStageCaptureRequest({ ...REQUEST, maxEdge: -1 })).toBeNull();
    });
});

describe("stageCaptureArea", () => {
    it("converts CSS pixels to the window's DIPs by the page zoom, rounding outwards", () => {
        expect(stageCaptureArea({ x: 10.5, y: 20.2, width: 100.1, height: 50 }, 1)).toEqual({ x: 10, y: 20, width: 101, height: 51 });
        expect(stageCaptureArea({ x: 0, y: 40, width: 1400, height: 787.5 }, 1.25)).toEqual({ x: 0, y: 50, width: 1750, height: 985 });
    });
});

describe("captureStageThumbnail", () => {
    it("reads back the stage's area, fits it to maxEdge and keeps it as JPEG", async () => {
        const log: string[] = [];
        const { contents, asked } = fakeContents(Promise.resolve(fakeImage(2800, 1575, log)));

        expect(await captureStageThumbnail(contents, REQUEST)).toBe("data:image/jpeg;base64,SlBFRw==");
        expect(asked).toEqual([{ x: 0, y: 40, width: 1400, height: 788 }]);
        expect(log).toEqual(['resize {"width":960,"quality":"good"}', "jpeg 85 960x540"]);
    });

    it("fits a portrait stage by its height and never scales a small one up", async () => {
        const log: string[] = [];
        await captureStageThumbnail(fakeContents(Promise.resolve(fakeImage(1080, 1920, log))).contents, REQUEST);
        expect(log[0]).toBe('resize {"height":960,"quality":"good"}');

        const small: string[] = [];
        await captureStageThumbnail(fakeContents(Promise.resolve(fakeImage(800, 450, small))).contents, REQUEST);
        expect(small).toEqual(["jpeg 85 800x450"]);
    });

    it("answers null for an empty frame, a refusal, or no answer in time", async () => {
        const log: string[] = [];
        expect(await captureStageThumbnail(fakeContents(Promise.resolve(fakeImage(2800, 1575, log, true))).contents, REQUEST)).toBeNull();
        expect(await captureStageThumbnail(fakeContents(Promise.reject(new Error("gone"))).contents, REQUEST)).toBeNull();
        expect(await captureStageThumbnail(fakeContents(new Promise<StageCaptureImage>(() => undefined)).contents, REQUEST, 10)).toBeNull();
        expect(log).toEqual([]);
    });
});
