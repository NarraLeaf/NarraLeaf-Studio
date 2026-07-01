import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import type { UIWidgetModule } from "./types";
import {
    DEFAULT_INSERT_PALETTE_CONFIG,
    resolveInsertPaletteEntries,
    type InsertPaletteConfigEntry,
} from "./insertPalette";
import type { UIStageSlotId, UISurface } from "@shared/types/ui-editor/document";

const DEFAULT_MODULE_TYPES = [
    "nl.container",
    "nl.text",
    "nl.dialog.sentence",
    "nl.image",
    "nl.button",
    "nl.slider",
    "nl.list",
    "nl.frame",
] as const;

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

function createStageSurface(slotId: UIStageSlotId): UISurface {
    return {
        id: `stage-${slotId}`,
        name: slotId,
        host: "player",
        kind: "stageSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root",
        mount: { kind: "slot", slotId },
    };
}

describe("insert palette", () => {
    it("resolves the default built-in entries with Page in overflow", () => {
        const entries = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            createResolver(DEFAULT_MODULE_TYPES),
        );

        expect(entries.map(entry => entry.module.type)).toEqual([
            "nl.container",
            "nl.text",
            "nl.image",
            "nl.button",
            "nl.slider",
            "nl.list",
            "nl.frame",
        ]);
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

    it("shows Dialog sentence widget only on Dialog stage surfaces", () => {
        const resolver = createResolver(DEFAULT_MODULE_TYPES);
        const dialogTypes = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            resolver,
            createStageSurface("dialog"),
        ).map(entry => entry.module.type);

        expect(dialogTypes).toContain("nl.dialog.sentence");
        expect(dialogTypes).not.toContain("nl.dialog.nametag");

        for (const slotId of ["onStage", "choice", "notification"] as const) {
            const types = resolveInsertPaletteEntries(
                DEFAULT_INSERT_PALETTE_CONFIG,
                resolver,
                createStageSurface(slotId),
            ).map(entry => entry.module.type);
            expect(types).not.toContain("nl.dialog.sentence");
            expect(types).not.toContain("nl.dialog.nametag");
        }

        const appTypes = resolveInsertPaletteEntries(
            DEFAULT_INSERT_PALETTE_CONFIG,
            resolver,
            "appSurface",
        ).map(entry => entry.module.type);
        expect(appTypes).not.toContain("nl.dialog.sentence");
        expect(appTypes).not.toContain("nl.dialog.nametag");
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
