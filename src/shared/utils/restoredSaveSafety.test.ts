import { describe, expect, it } from "vitest";
import { isSafeRestoredCssValue, isSafeRestoredUrl, sanitizeRestoredSave } from "./restoredSaveSafety";

describe("isSafeRestoredUrl", () => {
    it("passes relative paths, the runtime's own schemes, http(s) and image data", () => {
        for (const url of ["a.png", "/a.png", "nlgame://asset/1", "https://x/a.png", "blob:nlgame://runtime/1", "data:image/png;base64,AA", "#fff"]) {
            expect(isSafeRestoredUrl(url), url).toBe(true);
        }
    });

    it("refuses script and local-file schemes however they are spelled", () => {
        for (const url of ["javascript:1", "JAVASCRIPT:1", "java\tscript:1", " file:///etc/passwd", "vbscript:1", "filesystem:x", "data:text/html,x"]) {
            expect(isSafeRestoredUrl(url), url).toBe(false);
        }
    });
});

describe("isSafeRestoredCssValue", () => {
    it("checks every url() and image-set() string", () => {
        expect(isSafeRestoredCssValue("blur(2px)")).toBe(true);
        expect(isSafeRestoredCssValue("url('nlgame://asset/1')")).toBe(true);
        expect(isSafeRestoredCssValue("url(a.png), url(\"file:///x\")")).toBe(false);
        expect(isSafeRestoredCssValue("image-set('file:///x' 1x)")).toBe(false);
        expect(isSafeRestoredCssValue("u\\72l(file:///x)")).toBe(false);
    });
});

function save(elementStates: unknown[], history: unknown[] = []) {
    return { name: "s", meta: { storyHash: "h" }, game: { elementStates, history, store: {} } };
}

describe("sanitizeRestoredSave", () => {
    it("leaves a save the game wrote itself untouched", () => {
        const original = save([{ id: "img", data: { state: { currentSrc: "nlgame://asset/1" }, transformState: { filter: "blur(1px)" } } }]);
        const { save: result, removed } = sanitizeRestoredSave(original);
        expect(removed).toBe(0);
        expect(result).toEqual(original);
    });

    it("drops an element whose saved source is unsafe, so it falls back to the authored one", () => {
        const original = save([
            { id: "bad", data: { state: { currentSrc: "file:///etc/passwd" } } },
            { id: "bad-static", data: { state: { currentSrc: { src: "javascript:1" } } } },
            { id: "ok", data: { state: { currentSrc: ["smile"] } } },
        ]);
        const { save: result, removed } = sanitizeRestoredSave(original);
        expect(removed).toBe(2);
        expect(result.game.elementStates.map(entry => (entry as { id: string }).id)).toEqual(["ok"]);
        // The caller's object is not changed.
        expect(original.game.elementStates).toHaveLength(3);
    });

    it("removes unsafe transform values, in the game state and in backlog snapshots", () => {
        const tampered = { id: "img", data: { state: {}, transformState: { maskImage: "url(file:///x)", opacity: 1 } } };
        const { save: result, removed } = sanitizeRestoredSave(save([tampered], [{ token: "t", snapshot: { elementStates: [structuredClone(tampered)] } }]));
        expect(removed).toBe(2);
        const top = result.game.elementStates[0] as typeof tampered;
        expect(top.data.transformState).toEqual({ opacity: 1 });
        const history = result.game.history[0] as { snapshot: { elementStates: typeof tampered[] } };
        expect(history.snapshot.elementStates[0].data.transformState).toEqual({ opacity: 1 });
    });
});
