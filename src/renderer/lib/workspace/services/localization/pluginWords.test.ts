import { afterEach, describe, expect, it, vi } from "vitest";
import { listPluginWordsRows, registerPluginWords, subscribePluginWords, type PluginWordsEntry } from "./pluginWords";

/**
 * The words plugins offer for translation, as the translation table reads them: one row per word,
 * under a unit scoped to the plugin, for as long as the plugin is registered.
 */

const removals: (() => void)[] = [];

afterEach(() => {
    for (const remove of removals.splice(0)) {
        remove();
    }
});

function offer(pluginId: string, name: string, entries: PluginWordsEntry[] | (() => PluginWordsEntry[]), subscribe?: (listener: () => void) => () => void) {
    const list = typeof entries === "function" ? entries : () => entries;
    const remove = registerPluginWords(pluginId, () => name, { list, ...(subscribe ? { subscribe } : {}) });
    removals.push(remove);
    return remove;
}

describe("plugin words", () => {
    it("lists each word a plugin offers under a unit scoped to the plugin, grouped by its name", () => {
        offer("narraleaf.gallery", "画廊", [
            { id: "entry.e1.name", text: "放学后的走廊", context: "CG" },
            { id: "lockedNameMask", text: "未解锁" },
        ]);
        offer("narraleaf.menu-bar", "菜单栏", [{ id: "m.label", text: "Game", context: "Game" }]);
        expect(listPluginWordsRows()).toEqual([
            { unitId: "plugin:narraleaf.gallery/entry.e1.name", pluginId: "narraleaf.gallery", pluginName: "画廊", sourceText: "放学后的走廊", context: "CG" },
            { unitId: "plugin:narraleaf.gallery/lockedNameMask", pluginId: "narraleaf.gallery", pluginName: "画廊", sourceText: "未解锁", context: "画廊" },
            { unitId: "plugin:narraleaf.menu-bar/m.label", pluginId: "narraleaf.menu-bar", pluginName: "菜单栏", sourceText: "Game", context: "Game" },
        ]);
    });

    it("leaves out words with no letter, an id that is not one, and the same id twice", () => {
        offer("acme.words", "Words", [
            { id: "count", text: "100%" },
            { id: "bad id", text: "Hello" },
            { id: "", text: "Hello" },
            { id: "greeting", text: "Hello" },
            { id: "greeting", text: "Hello again" },
        ]);
        expect(listPluginWordsRows().map(row => [row.unitId, row.sourceText])).toEqual([["plugin:acme.words/greeting", "Hello"]]);
    });

    it("stops offering a plugin's words the moment it is taken away, and says that something changed", () => {
        const heard = vi.fn();
        removals.push(subscribePluginWords(heard));
        const remove = offer("acme.words", "Words", [{ id: "greeting", text: "Hello" }]);
        expect(heard).toHaveBeenCalledTimes(1);
        remove();
        expect(listPluginWordsRows()).toEqual([]);
        expect(heard).toHaveBeenCalledTimes(2);
    });

    it("passes on a plugin's own change notice, and reads its list afresh", () => {
        let words = [{ id: "greeting", text: "Hello" }];
        let notify: (() => void) | null = null;
        const heard = vi.fn();
        removals.push(subscribePluginWords(heard));
        offer("acme.words", "Words", () => words, listener => {
            notify = listener;
            return () => {
                notify = null;
            };
        });
        heard.mockClear();
        words = [{ id: "greeting", text: "Hi" }];
        notify!();
        expect(heard).toHaveBeenCalledTimes(1);
        expect(listPluginWordsRows()[0]?.sourceText).toBe("Hi");
        removals.pop()?.();
        expect(notify).toBeNull();
    });

    it("drops only the words of a plugin whose list throws", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        offer("acme.broken", "Broken", () => {
            throw new Error("nope");
        });
        offer("acme.words", "Words", [{ id: "greeting", text: "Hello" }]);
        expect(listPluginWordsRows().map(row => row.pluginId)).toEqual(["acme.words"]);
        error.mockRestore();
    });
});
