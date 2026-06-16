import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import type { UIWidgetModule } from "./types";
import {
    DEFAULT_INSERT_PALETTE_CONFIG,
    resolveInsertPaletteEntries,
    type InsertPaletteConfigEntry,
} from "./insertPalette";

const DEFAULT_MODULE_TYPES = ["nl.container", "nl.text", "nl.image", "nl.button", "nl.list"] as const;

function createModule(type: string): UIWidgetModule {
    return {
        type,
        displayName: type,
        icon: Box,
        createDefaultElement: () => ({ type }),
        render: () => null,
    };
}

function createResolver(types: readonly string[]) {
    const modules = new Map(types.map(type => [type, createModule(type)]));
    return (type: string) => modules.get(type);
}

describe("insert palette", () => {
    it("resolves the default built-in entries as primary palette items", () => {
        const entries = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            createResolver(DEFAULT_MODULE_TYPES),
        );

        expect(entries.map(entry => entry.module.type)).toEqual(DEFAULT_MODULE_TYPES);
        expect(entries.every(entry => entry.placement === "primary")).toBe(true);
    });

    it("keeps overflow entries in the resolved palette entries", () => {
        const config: InsertPaletteConfigEntry[] = [
            { type: "nl.container" },
            { type: "nl.custom", placement: "overflow" },
        ];

        const entries = resolveInsertPaletteEntries(config, createResolver(["nl.container", "nl.custom"]));

        expect(entries).toMatchObject([
            { module: { type: "nl.container" }, placement: "primary" },
            { module: { type: "nl.custom" }, placement: "overflow" },
        ]);
    });

    it("throws when a configured palette module is missing", () => {
        expect(() =>
            resolveInsertPaletteEntries([{ type: "nl.missing" }], () => undefined),
        ).toThrow("[insertPalette] Missing widget module for palette type: nl.missing");
    });
});
