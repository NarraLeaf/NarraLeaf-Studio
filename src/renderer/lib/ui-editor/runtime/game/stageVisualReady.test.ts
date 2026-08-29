// @vitest-environment jsdom
/**
 * The reveal path after "Start Game". Every animation frame and every forced style recalc here sits
 * between the player pressing the button and the UI beginning to leave, so a stage whose assets were
 * already fetched and decoded before the game was entered must not re-verify them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_SETTLE_FRAMES, waitForStageVisualReadyWithTimeout } from "./NlrStageLayer";

let frames = 0;
let computedStyleCalls = 0;

/** Let queued timers (and therefore the rAF stub) run to completion. */
async function flush(times = 8): Promise<void> {
    for (let i = 0; i < times; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

beforeEach(() => {
    frames = 0;
    computedStyleCalls = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames += 1;
        return window.setTimeout(() => callback(0), 0) as unknown as number;
    });
    // jsdom loads nothing, so the off-document probe `waitForImageUrl` builds would never settle.
    // Stand in for a source that resolves from cache.
    vi.stubGlobal("Image", class {
        public complete = true;
        public naturalWidth = 0;
        public onload: (() => void) | null = null;
        public onerror: (() => void) | null = null;
        set src(_value: string) {
            setTimeout(() => this.onload?.(), 0);
        }
    });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
        computedStyleCalls += 1;
        return real(element as HTMLElement);
    }) as typeof window.getComputedStyle);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

/** A stage with one already-loaded image and one CSS background, as a revealed scene would have. */
function makeStage(): HTMLElement {
    const root = document.createElement("div");
    root.style.backgroundImage = 'url("bg.png")';
    const image = document.createElement("img");
    // Complete but with no bitmap: the branch that skips `decode()`, which jsdom does not implement.
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", { value: 0 });
    root.appendChild(image);
    document.body.appendChild(root);
    return root;
}

describe("waitForStageVisualReadyWithTimeout", () => {
    it("spends two frames plus the settle window on a warm stage", async () => {
        await waitForStageVisualReadyWithTimeout(makeStage(), { warm: true });
        expect(frames).toBe(2 + STAGE_SETTLE_FRAMES);
    });

    it("spends four plus the settle window on a cold one", async () => {
        await waitForStageVisualReadyWithTimeout(makeStage(), { warm: false });
        expect(frames).toBe(4 + STAGE_SETTLE_FRAMES);
    });

    it("defaults to the cold path when the caller says nothing", async () => {
        await waitForStageVisualReadyWithTimeout(makeStage());
        expect(frames).toBe(4 + STAGE_SETTLE_FRAMES);
    });

    it("skips the whole-subtree style recalc on a warm stage", async () => {
        await waitForStageVisualReadyWithTimeout(makeStage(), { warm: true });
        expect(computedStyleCalls).toBe(0);
    });

    it("still sweeps CSS backgrounds on a cold stage", async () => {
        await waitForStageVisualReadyWithTimeout(makeStage(), { warm: false });
        expect(computedStyleCalls).toBeGreaterThan(0);
    });

    it("holds the reveal while the scene is still putting elements on the stage", async () => {
        const root = makeStage();
        let settled = false;
        void waitForStageVisualReadyWithTimeout(root, { warm: true }).then(() => {
            settled = true;
        });

        // One element per pass, the way the engine's serial `displayable:init` puts them there.
        for (let i = 0; i < 3; i += 1) {
            await flush(2);
            expect(settled).toBe(false);
            const image = document.createElement("img");
            image.setAttribute("src", `sprite-${i}.png`);
            Object.defineProperty(image, "complete", { value: true });
            Object.defineProperty(image, "naturalWidth", { value: 0 });
            root.appendChild(image);
        }

        await flush(16);
        expect(settled).toBe(true);
    });

    it("reveals a stage that never stops changing, as soon as one of its images is painting", async () => {
        const root = document.createElement("div");
        const image = document.createElement("img");
        Object.defineProperty(image, "complete", { value: true });
        Object.defineProperty(image, "naturalWidth", { value: 1280 });
        image.getBoundingClientRect = () => ({ width: 1280, height: 720 }) as DOMRect;
        // jsdom implements no decoder, and this is the one stage here whose image reports a bitmap.
        (image as HTMLImageElement & { decode: () => Promise<void> }).decode = () => Promise.resolve();
        root.appendChild(image);
        document.body.appendChild(root);
        // A source that changes every frame never settles, so the settle window alone would hold
        // the reveal until the caller times out.
        let tick = 0;
        const churn = window.setInterval(() => {
            image.setAttribute("src", `frame-${tick += 1}.png`);
        }, 0);

        await waitForStageVisualReadyWithTimeout(root, { warm: true });
        window.clearInterval(churn);
        expect(frames).toBeLessThan(2 + STAGE_SETTLE_FRAMES);
    });

    it("waits for an element that has not loaded yet, warm or not", async () => {
        const root = document.createElement("div");
        const image = document.createElement("img");
        let loaded = false;
        Object.defineProperty(image, "complete", { get: () => loaded });
        Object.defineProperty(image, "naturalWidth", { value: 0 });
        root.appendChild(image);
        document.body.appendChild(root);

        let settled = false;
        void waitForStageVisualReadyWithTimeout(root, { warm: true }).then(() => {
            settled = true;
        });

        await flush();
        expect(settled).toBe(false);

        loaded = true;
        image.dispatchEvent(new Event("load"));
        await flush(16);
        expect(settled).toBe(true);
    });
});
