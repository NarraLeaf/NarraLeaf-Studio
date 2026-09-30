import { describe, expect, it, vi } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { Services } from "../../services";
import { assetSource, extractAssetEntries, extractAssetSetEntries } from "./assetSource";
import { extractCharacterEntries } from "./characterSource";
import { extractLocalizationKeyEntries } from "./localizationKeySource";
import { extractSurfaceEntries } from "./surfaceSource";
import type { LocalizationKeysDocument } from "@shared/types/localization";

const keysDoc: LocalizationKeysDocument = {
    schemaVersion: 1,
    keys: {
        "menu.start": { sourceText: "Start Game" },
        "menu.quit": { sourceText: "Quit" },
    },
} as LocalizationKeysDocument;

describe("extractCharacterEntries", () => {
    it("indexes the cast by name with their group as context", () => {
        const entries = extractCharacterEntries([
            { id: "c1", name: "Inko", groupName: "Main Cast", aux: "childhood friend" },
            { id: "c2", name: "" },
        ]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            group: "character",
            text: "Inko",
            detail: "Main Cast",
            aux: "childhood friend",
            target: { kind: "character", characterId: "c1" },
        });
    });
});

describe("extractSurfaceEntries", () => {
    it("indexes surfaces by name with their kind as context", () => {
        const entries = extractSurfaceEntries([
            { id: "s1", name: "Main Menu", kindLabel: "Page" },
            { id: "s2", name: "" },
        ]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            group: "uiSurface",
            text: "Main Menu",
            detail: "Page",
            target: { kind: "uiSurface", surfaceId: "s1" },
        });
    });
});

describe("extractLocalizationKeyEntries", () => {
    it("indexes key names with source text as detail", () => {
        const entries = extractLocalizationKeyEntries(keysDoc);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({
            group: "uiTextKey",
            text: "menu.start",
            detail: "Start Game",
            target: { kind: "localizationKey", keyName: "menu.start" },
        });
    });
});

describe("extractAssetEntries", () => {
    it("indexes assets by name with tags/description as detail and a typed target", () => {
        const entries = extractAssetEntries([
            { id: "a1", type: "image", name: "background.webp", tags: ["bg", "day"], description: "Town square" },
            { id: "a2", type: "audio", name: "bgm-main.ogg" },
        ]);
        expect(entries[0]).toMatchObject({
            group: "asset",
            text: "background.webp",
            detail: "bg, day, Town square",
            target: { kind: "asset", assetId: "a1", assetType: "image" },
        });
        expect(entries[1]?.detail).toBeUndefined();
    });

    it("skips unnamed assets", () => {
        expect(extractAssetEntries([{ id: "a3", type: "image", name: "" }])).toHaveLength(0);
    });

    it("prints a set member's tags the way the reader says, and leaves out the ones it does not print", () => {
        // A member of an asset set carries the set's id among its tags; the reader the slice is built
        // with prints none of that (see `readAssetTag`).
        const readTag = (tag: string) => (tag.startsWith("set:") ? null : tag === "locale:ja" ? "Language: 日本語" : tag);
        const [entry] = extractAssetEntries([{
            id: "a4",
            type: "image",
            name: "title_ja",
            tags: ["title", "set:a55e7001-0000-4000-8000-000000000001", "locale:ja"],
        }], readTag);
        expect(entry?.detail).toBe("title, Language: 日本語");
    });
});

describe("extractAssetSetEntries", () => {
    it("indexes sets beside the files, under a target that opens them differently", () => {
        // The same group as the files on purpose: an author searching for "Room" has not first
        // decided whether it is a file or a set, and the target is what tells the jump which.
        const entries = extractAssetSetEntries([
            { id: "s1", type: "image", name: "Room", filter: ["room"] },
            { id: "s2", type: "audio", name: "Chime" },
        ]);
        expect(entries[0]).toMatchObject({
            group: "asset",
            text: "Room",
            detail: "room",
            target: { kind: "assetSet", assetSetId: "s1" },
        });
        expect(entries[1]?.detail).toBeUndefined();
    });

    it("skips unnamed sets", () => {
        expect(extractAssetSetEntries([{ id: "s3", type: "image", name: "" }])).toHaveLength(0);
    });

    it("has no detail for a set whose only tag is its own id", () => {
        const readTag = (tag: string) => (tag.startsWith("set:") ? null : tag);
        const [entry] = extractAssetSetEntries([{
            id: "a55e7001-0000-4000-8000-000000000001",
            type: "image",
            name: "Title card",
            filter: ["set:a55e7001-0000-4000-8000-000000000001"],
        }], readTag);
        expect(entry?.detail).toBeUndefined();
    });
});

describe("assetSource.watch", () => {
    it("rebuilds when the interface language changes, since a set's tag words are written in it", () => {
        const off = () => undefined;
        const context = {
            services: {
                get(id: string) {
                    if (id === Services.Assets) {
                        return { getEvents: () => ({ on: () => off }) };
                    }
                    if (id === Services.AssetSets) return { onSetsChanged: () => off };
                    if (id === Services.Localization) return { onConfigChanged: () => off };
                    if (id === Services.AppTags) return { onTagsChanged: () => off };
                    throw new Error(`Unexpected service ${id}`);
                },
            },
        } as never;
        i18nStore.setLocale("en");
        const invalidate = vi.fn();
        const stop = assetSource.watch!(context, { invalidate, invalidateAll: vi.fn() } as never);
        i18nStore.setLocale("zh");
        expect(invalidate).toHaveBeenCalled();

        stop();
        invalidate.mockClear();
        i18nStore.setLocale("ja");
        expect(invalidate).not.toHaveBeenCalled();
        i18nStore.setLocale("en");
    });
});
