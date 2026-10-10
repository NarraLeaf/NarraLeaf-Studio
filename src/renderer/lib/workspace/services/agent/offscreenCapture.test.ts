// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OffscreenCapture, waitForOffscreenPage } from "./offscreenCapture";

const site = { surfaceId: "page", elementId: "art", ownerName: "Key art", slot: "imageFill" as const, instanceKey: "" };

describe("OffscreenCapture", () => {
    it("counts a lookup once however many times it is ended", () => {
        const capture = new OffscreenCapture();
        const end = capture.begin("a");
        capture.begin("b");
        expect(capture.pendingLookups()).toEqual(["a", "b"]);
        end();
        end();
        expect(capture.pendingLookups()).toEqual(["b"]);
    });

    it("names failed slots, by asset name when the project knows it, and forgets a drawing that went away", () => {
        const capture = new OffscreenCapture(() => ({ "5322b0e3-f48d-4b77-bfcd-7406613191ce": "room.png" }));
        capture.report({ type: "outcome", drawing: "d1", site, outcome: { status: "failed", requested: "5322b0e3-f48d-4b77-bfcd-7406613191ce", stage: "resolve" } });
        capture.report({ type: "outcome", drawing: "d2", site, outcome: { status: "failed", requested: "a4d2552e-a1db-4226-b224-e88d072f57b0", stage: "resolve" } });
        expect(capture.failedSlots()).toEqual([
            'Key art (imageFill): asset "room.png" (5322b0e3-f48d-4b77-bfcd-7406613191ce) could not be read or decoded',
            'Key art (imageFill): "a4d2552e-a1db-4226-b224-e88d072f57b0" is not an asset of this project (deleted, or an id from elsewhere)',
        ]);
        capture.report({ type: "outcome", drawing: "d1", site, outcome: { status: "drawn" } });
        capture.report({ type: "released", drawing: "d2" });
        expect(capture.failedSlots()).toEqual([]);
    });
});

describe("waitForOffscreenPage", () => {
    it("waits for a lookup in flight and the picture it brings, not for a clock", async () => {
        const box = document.createElement("div");
        document.body.appendChild(box);
        const capture = new OffscreenCapture();
        const end = capture.begin("art");
        // The lookup ends a while after mounting, and the picture is only added then - the shape of
        // a page whose key art comes over IPC.
        setTimeout(() => {
            const image = document.createElement("div");
            image.style.backgroundImage = "url(blob:x)";
            box.appendChild(image);
            end();
        }, 150);
        const readiness = await waitForOffscreenPage(box, capture, { timeoutMs: 3000 });
        expect(readiness.outstanding).toEqual([]);
        expect(box.children).toHaveLength(1);
        expect(readiness.elapsedMs).toBeGreaterThanOrEqual(150);
        box.remove();
    });

    it("waits for a nested page's prepaint, and names what is still outstanding at the deadline", async () => {
        const box = document.createElement("div");
        const frame = document.createElement("div");
        frame.setAttribute("data-ui-surface-prepaint", "pending");
        box.appendChild(frame);
        document.body.appendChild(box);
        const capture = new OffscreenCapture();
        capture.begin("slow-asset");
        const readiness = await waitForOffscreenPage(box, capture, { timeoutMs: 200, describe: () => "Root/Frame" });
        expect(readiness.outstanding).toEqual(["asset slow-asset (still loading)", "Root/Frame (not revealed yet)"]);
        box.remove();
    });
});
