import { describe, expect, it } from "vitest";
import { bestHead, headFrame, HEAD_DETECT_THRESHOLD, letterbox, toInputTensor } from "./headDetection";

/** A `[1, 5, anchors]` output with the given boxes (input pixels) and scores. */
function output(anchors: number, boxes: { index: number; cx: number; cy: number; w: number; h: number; score: number }[]): Float32Array {
    const data = new Float32Array(5 * anchors);
    for (const box of boxes) {
        data[box.index] = box.cx;
        data[anchors + box.index] = box.cy;
        data[2 * anchors + box.index] = box.w;
        data[3 * anchors + box.index] = box.h;
        data[4 * anchors + box.index] = box.score;
    }
    return data;
}

describe("letterbox", () => {
    it("fits a tall picture by its height and centres it across", () => {
        const box = letterbox(1000, 2000);
        expect(box.scale).toBeCloseTo(0.32);
        expect(box.drawHeight).toBe(640);
        expect(box.drawWidth).toBe(320);
        expect(box.offsetX).toBe(160);
        expect(box.offsetY).toBe(0);
    });

    it("fits a wide picture by its width", () => {
        const box = letterbox(1920, 1080);
        expect(box.drawWidth).toBe(640);
        expect(box.offsetX).toBe(0);
        expect(box.offsetY).toBe(Math.floor((640 - box.drawHeight) / 2));
    });
});

describe("bestHead", () => {
    const tall = letterbox(1000, 2000);

    it("maps the best box back onto the picture", () => {
        const data = output(8, [
            { index: 2, cx: 320, cy: 64, w: 64, h: 64, score: 0.9 },
            { index: 5, cx: 300, cy: 400, w: 40, h: 40, score: 0.5 },
        ]);
        const head = bestHead(data, 8, tall)!;
        expect(head.score).toBeCloseTo(0.9);
        // Input x 288..352 minus the 160 offset, over 0.32.
        expect(head.x0).toBeCloseTo(400);
        expect(head.x1).toBeCloseTo(600);
        expect(head.y0).toBeCloseTo(100);
        expect(head.y1).toBeCloseTo(300);
    });

    it("finds nothing below the threshold", () => {
        const data = output(4, [{ index: 0, cx: 100, cy: 100, w: 10, h: 10, score: HEAD_DETECT_THRESHOLD - 0.01 }]);
        expect(bestHead(data, 4, tall)).toBeNull();
    });
});

describe("headFrame", () => {
    it("is a padded square on the longer side, centred on the head", () => {
        const frame = headFrame({ score: 1, x0: 400, y0: 100, x1: 600, y1: 300 }, 1000, 2000);
        const size = 200 * 1.12;
        expect(frame.w * 1000).toBeCloseTo(size);
        expect(frame.h * 2000).toBeCloseTo(size);
        expect(frame.x * 1000 + (frame.w * 1000) / 2).toBeCloseTo(500);
        expect(frame.y * 2000 + (frame.h * 2000) / 2).toBeCloseTo(200);
    });

    it("stays inside the picture", () => {
        const frame = headFrame({ score: 1, x0: -20, y0: -30, x1: 180, y1: 170 }, 1000, 2000);
        expect(frame.x).toBe(0);
        expect(frame.y).toBe(0);
        const wide = headFrame({ score: 1, x0: 0, y0: 0, x1: 900, y1: 900 }, 1000, 600);
        expect(wide.h).toBe(1);
        expect(wide.w * 1000).toBeCloseTo(600);
    });
});

describe("toInputTensor", () => {
    it("writes channel-major RGB in 0-1", () => {
        const rgba = new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 102, 0, 0, 0, 0, 255, 255, 255, 255, 255]);
        const tensor = toInputTensor(rgba, 2);
        expect(Array.from(tensor.slice(0, 4))).toEqual([1, 0, 0, 1]);
        expect(Array.from(tensor.slice(4, 8))).toEqual([0, 1, 0, 1]);
        expect(tensor[8]).toBeCloseTo(0.2);
        expect(tensor[9]).toBeCloseTo(0.4);
    });
});
