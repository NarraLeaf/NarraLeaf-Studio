import { describe, expect, it } from "vitest";
import { extractAssetEntries } from "./assetSource";
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
});
