import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_RUNTIME_BRIDGE_KEY } from "@shared/types/gameRuntime";
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
        constructor(public readonly family: string, public readonly source: ArrayBuffer) {
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
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetRuntimeFontFacesForTest();
    });

    it("builds one face for callers that arrive while the first load is still in flight", async () => {
        const first = loadRuntimeFontFace("body", "nlgame://asset/body");
        const second = loadRuntimeFontFace("body", "nlgame://asset/body");
        const third = loadRuntimeFontFace("body", "nlgame://asset/body");

        // The bytes are fetched before the face is built, so the face exists a tick later.
        await vi.waitFor(() => expect(resolveLoads).toHaveLength(1));
        expect(built).toEqual([runtimeFontCssFamily("body")]);
        expect(fetch).toHaveBeenCalledTimes(1);

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

        await vi.waitFor(() => expect(resolveLoads).toHaveLength(1));
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
        await vi.waitFor(() => expect(resolveLoads).toHaveLength(2));
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
    it("registers the face from the font's bytes rather than handing the loader the asset URL", async () => {
        const load = loadRuntimeFontFace("body", "nlgame://asset/body");
        // The fetch settles on a later tick than the call, so wait for the face to exist.
        await vi.waitFor(() => expect(resolveLoads).toHaveLength(1));
        resolveLoads[0]();
        await load;

        expect(fetch).toHaveBeenCalledWith("nlgame://asset/body");
        const face = added[0] as FakeFontFace;
        expect(face.source).toBeInstanceOf(ArrayBuffer);
    });

    it("publishes the face as a stylesheet rule as well, so the engine's picture of the stage is set in it", async () => {
        // The engine's stage capture reads `@font-face` rules out of the document's style sheets and
        // nothing else; a face only in `document.fonts` left every save thumbnail in the fallback face.
        const written: string[] = [];
        const sheet = {
            setAttribute: () => undefined,
            appendChild: (node: { text: string }) => written.push(node.text),
        };
        vi.stubGlobal("document", {
            fonts: { add: (face: unknown) => added.push(face) },
            head: { querySelector: () => null, appendChild: () => undefined },
            createElement: () => sheet,
            createTextNode: (text: string) => ({ text }),
        });
        vi.stubGlobal("URL", { createObjectURL: () => "blob:nlgame://runtime/1" });

        const load = loadRuntimeFontFace("body", "nlgame://asset/body");
        await vi.waitFor(() => expect(resolveLoads).toHaveLength(1));
        resolveLoads[0]();
        await load;

        expect(added).toHaveLength(1);
        expect(written).toHaveLength(1);
        expect(written[0]).toContain(`font-family: "${runtimeFontCssFamily("body")}"`);
        expect(written[0]).toContain('src: url("blob:nlgame://runtime/1")');
    });

    it("says in the game's log once when a font's bytes cannot be read, and draws nothing from it", async () => {
        const log = vi.fn();
        vi.stubGlobal("window", { [GAME_RUNTIME_BRIDGE_KEY]: { log } });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));

        await expect(loadRuntimeFontFace("body", "nlgame://asset/body")).rejects.toThrow("HTTP 404");
        await expect(loadRuntimeFontFace("body", "nlgame://asset/body")).rejects.toThrow("HTTP 404");

        expect(built).toHaveLength(0);
        expect(registeredRuntimeFontCssFamily("body")).toBeNull();
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]).toEqual(["warning", expect.stringContaining("body could not be read (HTTP 404)")]);
    });
});
