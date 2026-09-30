import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    loadRuntimeFontFace,
    registeredRuntimeFontCssFamily,
    resetRuntimeFontFacesForTest,
    runtimeFontCssFamily,
} from "./runtimeFontFaces";

/**
 * The registry exists because a shipped game used to load one typeface several times over: once in
 * the boot preload and once more per text widget that mounted before that load settled. With a CJK
 * font each of those is tens of megabytes of resident font data, so the count is the assertion.
 */
describe("runtime font faces", () => {
    const built: string[] = [];
    const added: unknown[] = [];
    let resolveLoads: Array<() => void> = [];

    class FakeFontFace {
        constructor(public readonly family: string, public readonly source: string) {
            built.push(family);
        }

        load(): Promise<FakeFontFace> {
            // Held open so a second caller has something to join, which is the case that used to
            // start a second download.
            return new Promise(resolve => {
                resolveLoads.push(() => resolve(this));
            });
        }
    }

    beforeEach(() => {
        built.length = 0;
        added.length = 0;
        resolveLoads = [];
        resetRuntimeFontFacesForTest();
        vi.stubGlobal("FontFace", FakeFontFace);
        vi.stubGlobal("document", { fonts: { add: (face: unknown) => added.push(face) } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetRuntimeFontFacesForTest();
    });

    it("builds one face for callers that arrive while the first load is still in flight", async () => {
        const first = loadRuntimeFontFace("body", "nlgame://asset/body");
        const second = loadRuntimeFontFace("body", "nlgame://asset/body");
        const third = loadRuntimeFontFace("body", "nlgame://asset/body");

        expect(built).toEqual([runtimeFontCssFamily("body")]);

        for (const resolve of resolveLoads) {
            resolve();
        }

        expect(await Promise.all([first, second, third])).toEqual([
            runtimeFontCssFamily("body"),
            runtimeFontCssFamily("body"),
            runtimeFontCssFamily("body"),
        ]);
        expect(built).toHaveLength(1);
        expect(added).toHaveLength(1);
    });

    it("answers a registered face without loading it again", async () => {
        const load = loadRuntimeFontFace("body", "nlgame://asset/body");
        expect(registeredRuntimeFontCssFamily("body")).toBeNull();

        resolveLoads[0]();
        await load;

        expect(registeredRuntimeFontCssFamily("body")).toBe(runtimeFontCssFamily("body"));
        await loadRuntimeFontFace("body", "nlgame://asset/body");
        expect(built).toHaveLength(1);
    });

    it("keeps two fonts apart", async () => {
        const loads = [
            loadRuntimeFontFace("body", "nlgame://asset/body"),
            loadRuntimeFontFace("display", "nlgame://asset/display"),
        ];
        for (const resolve of resolveLoads) {
            resolve();
        }
        await Promise.all(loads);

        expect(built).toEqual([runtimeFontCssFamily("body"), runtimeFontCssFamily("display")]);
        expect(runtimeFontCssFamily("body")).not.toBe(runtimeFontCssFamily("display"));
    });

    it("lets a failed load be retried rather than caching the failure", async () => {
        class FailingFontFace {
            constructor(public readonly family: string) {
                built.push(family);
            }

            load(): Promise<never> {
                return Promise.reject(new Error("no bytes"));
            }
        }
        vi.stubGlobal("FontFace", FailingFontFace);

        await expect(loadRuntimeFontFace("body", "nlgame://asset/body")).rejects.toThrow("no bytes");
        expect(registeredRuntimeFontCssFamily("body")).toBeNull();

        await expect(loadRuntimeFontFace("body", "nlgame://asset/body")).rejects.toThrow("no bytes");
        expect(built).toHaveLength(2);
    });
});
