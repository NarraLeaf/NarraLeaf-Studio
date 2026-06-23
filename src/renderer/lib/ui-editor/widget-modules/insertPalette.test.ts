import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import type { UIWidgetModule } from "./types";
import {
    DEFAULT_INSERT_PALETTE_CONFIG,
    resolveInsertPaletteEntries,
    type InsertPaletteConfigEntry,
} from "./insertPalette";

const DEFAULT_MODULE_TYPES = ["nl.container", "nl.text", "nl.image", "nl.button", "nl.slider", "nl.list", "nl.frame"] as const;

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
    it("resolves the default built-in entries with Page in overflow", () => {
        const entries = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            createResolver(DEFAULT_MODULE_TYPES),
        );

        expect(entries.map(entry => entry.module.type)).toEqual(DEFAULT_MODULE_TYPES);
        expect(entries.map(entry => entry.placement)).toEqual([
            "primary",
            "primary",
            "primary",
            "primary",
            "overflow",
            "overflow",
            "overflow",
        ]);
    });

    it("filters surface-aware entries by surface kind", () => {
        const appEntries = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            createResolver(DEFAULT_MODULE_TYPES),
            "appSurface",
        );
        const stageEntries = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            createResolver(DEFAULT_MODULE_TYPES),
            "stageSurface",
        );

        expect(appEntries.map(entry => entry.module.type)).toContain("nl.frame");
        expect(stageEntries.map(entry => entry.module.type)).not.toContain("nl.frame");
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
