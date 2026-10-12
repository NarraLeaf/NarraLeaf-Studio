import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { blueprintDisplayName } from "@shared/types/ui-editor/ownerLabels";
import { blueprintOwnerPath } from "@/lib/workspace/services/search/sources/blueprintSource";
import { distinguishQuickOpenDetails, type QuickOpenPlacedRow } from "./quickOpenPlaces";

/** A row placed at `lead › leaf`, with the controls above `leaf` nearest first. */
function row(title: string, lead: string[], leaf?: string, ancestors: string[] = [], suffix?: string): QuickOpenPlacedRow {
    return { title, place: { path: { lead, leaf, ancestors }, suffix } };
}

describe("quick open detail lines", () => {
    it("leaves a row that already reads uniquely as Page › Control", () => {
        expect(distinguishQuickOpenDetails([
            row("Save", ["Config"], "Save", ["Rail", "Config"]),
            row("Load", ["Config"], "Load", ["Rail", "Config"]),
        ])).toEqual(["Config › Save", "Config › Load"]);
    });

    // The reported pair: the page's own container and the rail item, both named after the page.
    it("names the group a control is in when another control of the page has its name", () => {
        expect(distinguishQuickOpenDetails([
            row("Config", ["Config"], "Config"),
            row("Config", ["Config"], "Config", ["Rail", "Config"]),
        ])).toEqual(["Config › Config", "Config › Rail › Config"]);
    });

    it("names only as many groups as it takes", () => {
        expect(distinguishQuickOpenDetails([
            row("Track", ["Config"], "Track", ["Text speed slider", "Text speed row", "Text panel"]),
            row("Track", ["Config"], "Track", ["Volume slider", "Volume row", "Sound panel"]),
            row("Track", ["Config"], "Track", ["Slider", "Row A", "Panel"]),
            row("Track", ["Config"], "Track", ["Slider", "Row B", "Panel"]),
        ])).toEqual([
            "Config › Text speed slider › Track",
            "Config › Volume slider › Track",
            "Config › Row A › Slider › Track",
            "Config › Row B › Slider › Track",
        ]);
    });

    it("tells a control's value binding from its logic by kind, since every name on the way is shared", () => {
        expect(distinguishQuickOpenDetails([
            row("Name plate", ["Dialogue"], "Name plate", ["Plate"]),
            row("Name plate", ["Dialogue"], "Name plate", ["Plate"], "Widget value"),
        ])).toEqual(["Dialogue › Name plate", "Dialogue › Name plate · Widget value"]);
    });

    it("does not lengthen rows whose titles already differ", () => {
        expect(distinguishQuickOpenDetails([
            row("Open", ["Gallery"], "Cell", ["CG grid"]),
            row("Close", ["Gallery"], "Cell", ["Replay grid"]),
        ])).toEqual(["Gallery › Cell", "Gallery › Cell"]);
    });

    it("keeps no detail for a row with no place", () => {
        expect(distinguishQuickOpenDetails([{ title: "Ghost", place: undefined }])).toEqual([undefined]);
    });
});

/**
 * The starter every new project begins from, in all three of its languages: no two of its blueprints
 * may come out of Quick Open reading the same. Read from the shipped files, so a control added to the
 * template with a name its page already uses is caught here rather than by an author.
 */
describe("quick open over the starter template", () => {
    const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");
    const t = (key: TranslationKey): string => key;

    for (const variant of ["content", "content.zh", "content.ja"]) {
        it(`lists every blueprint of ${variant} under a row of its own`, () => {
            const read = (file: string) => JSON.parse(fs.readFileSync(path.join(TEMPLATE, variant, "editor/ui", file), "utf-8"));
            const ui = read("uidoc.json") as UIDocument;
            const blueprints = (read("uigraphs.json") as { blueprintDocument: BlueprintDocument }).blueprintDocument;
            const rows: QuickOpenPlacedRow[] = [];
            for (const [ownerKey, record] of Object.entries(blueprints.ownerRecords)) {
                const blueprint = blueprints.blueprints[record.blueprintId];
                const owner = decodeBlueprintOwnerKey(ownerKey);
                if (!blueprint || !owner) {
                    continue;
                }
                const placePath = blueprintOwnerPath(owner, ui, t);
                rows.push({
                    title: blueprintDisplayName(blueprint, t),
                    place: placePath ? { path: placePath, suffix: owner.kind === "widgetValue" ? "value" : undefined } : undefined,
                });
            }
            expect(rows.length).toBeGreaterThan(50);
            const details = distinguishQuickOpenDetails(rows);
            const read2 = rows.map((entry, index) => `${entry.title} | ${details[index] ?? ""}`);
            const repeated = read2.filter((text, index) => read2.indexOf(text) !== index);
            expect(repeated).toEqual([]);
        });
    }
});
