import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, type GameLocalizationBundle } from "@shared/types/localization";
import { ScopeStoreBridge, type BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { applyRunLocalePin, pinnedRunLocale, RunLocaleYield } from "./runLocalePin";

/**
 * The run menu's language reaching the game, and staying out of the player's store.
 *
 * Driven against a real `ScopeStoreBridge` with a store behind it, because the promise being kept is
 * about two halves of one write: the game reads the pinned language, and the store - the player's
 * saved data, which outlives this run - is never told.
 */

const LOCALIZATION: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> = {
    sourceLocale: "zh-CN",
    locales: [
        { code: "zh-CN", displayName: "简体中文" },
        { code: "en", displayName: "English" },
        { code: "ja", displayName: "日本語" },
    ],
};

function storeWith(initial: Record<string, unknown>) {
    const values = { ...initial };
    const writes: [string, unknown][] = [];
    const adapter: BlueprintPersistentStoreAdapter = {
        getAll: async () => ({ ...values }),
        getValue: async key => values[key],
        setValue: async (key, value) => {
            writes.push([key, value]);
            values[key] = value;
        },
        removeValue: async key => {
            writes.push([key, undefined]);
            delete values[key];
        },
    };
    return { adapter, writes };
}

async function bridgeOver(adapter: BlueprintPersistentStoreAdapter): Promise<ScopeStoreBridge> {
    const bridge = new ScopeStoreBridge();
    bridge.setPersistenceAdapter(adapter);
    await bridge.reloadPersistenceSnapshot();
    return bridge;
}

describe("applyRunLocalePin", () => {
    it("shows the run in the chosen language over the player's saved one", async () => {
        const { adapter } = storeWith({ [LOCALE_STORAGE_KEY]: "ja" });
        const bridge = await bridgeOver(adapter);

        expect(applyRunLocalePin(bridge, "en", LOCALIZATION, null)).toBe(true);
        expect(bridge.persistenceGet(LOCALE_STORAGE_KEY)).toBe("en");
    });

    it("never writes the player's store", async () => {
        const { adapter, writes } = storeWith({ [LOCALE_STORAGE_KEY]: "ja" });
        const bridge = await bridgeOver(adapter);

        applyRunLocalePin(bridge, "en", LOCALIZATION, null);

        expect(writes).toEqual([]);
        // The store still holds what the player chose, for the next run without a choice.
        expect(await adapter.getValue(LOCALE_STORAGE_KEY)).toBe("ja");
    });

    it("leaves the language to the game when no language was chosen", async () => {
        const { adapter } = storeWith({ [LOCALE_STORAGE_KEY]: "ja" });
        const bridge = await bridgeOver(adapter);

        expect(applyRunLocalePin(bridge, undefined, LOCALIZATION, null)).toBe(false);
        expect(bridge.persistenceGet(LOCALE_STORAGE_KEY)).toBe("ja");
    });
});

describe("pinnedRunLocale", () => {
    it("pins the source language too", () => {
        expect(pinnedRunLocale("zh-CN", LOCALIZATION, null)).toBe("zh-CN");
    });

    it("pins nothing the project does not have", () => {
        expect(pinnedRunLocale("fr", LOCALIZATION, null)).toBeNull();
    });

    it("pins nothing in a project that reads only its keys", () => {
        expect(pinnedRunLocale("en", { ...LOCALIZATION, sourceLocale: "" }, null)).toBeNull();
    });

    it("steps aside for the pin the game switched away from", () => {
        expect(pinnedRunLocale("en", LOCALIZATION, "en")).toBeNull();
        expect(pinnedRunLocale("ja", LOCALIZATION, "en")).toBe("ja");
    });
});

describe("RunLocaleYield", () => {
    it("keeps the yield across the reload a language switch causes", () => {
        const yieldState = new RunLocaleYield();
        yieldState.noteBundle("en");
        yieldState.noteGameSwitch("en");
        // The restart is a session reload carrying the same pin.
        yieldState.noteBundle("en");

        expect(yieldState.yieldedTo()).toBe("en");
    });

    it("forgets it when the run menu names a language again", () => {
        const yieldState = new RunLocaleYield();
        yieldState.noteBundle("en");
        yieldState.noteGameSwitch("en");
        yieldState.noteBundle("ja");
        yieldState.noteBundle("en");

        expect(yieldState.yieldedTo()).toBeNull();
    });

    it("records nothing when no language is pinned", () => {
        const yieldState = new RunLocaleYield();
        yieldState.noteBundle(undefined);
        yieldState.noteGameSwitch(undefined);

        expect(yieldState.yieldedTo()).toBeNull();
    });
});
