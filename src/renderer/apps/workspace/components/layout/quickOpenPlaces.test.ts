import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { blueprintDisplayName } from "@shared/types/ui-editor/ownerLabels";
import { blueprintOwnerPath } from "@/lib/workspace/services/search/sources/blueprintSource";
import { blueprintPlaceDetails, distinguishQuickOpenDetails, type QuickOpenPlacedRow } from "./quickOpenPlaces";

/** A blueprint row placed at `lead › leaf`, with the controls above `leaf` nearest first. */
function row(title: string, lead: string[], leaf?: string, ancestors: string[] = [], suffix?: string): QuickOpenPlacedRow {
    return { kind: "blueprint", title, details: blueprintPlaceDetails({ path: { lead, leaf, ancestors }, suffix }) };
}

/** Numbers a row the way the picker does, with a mark these tests can read. */
const numbered = (detail: string | undefined, ordinal: number) => (detail ? `${detail} · #${ordinal}` : `#${ordinal}`);

/** Settle the detail lines of `rows`. */
function distinguish(rows: QuickOpenPlacedRow[]): (string | undefined)[] {
    return distinguishQuickOpenDetails(rows, numbered);
}

describe("quick open detail lines", () => {
    it("leaves a row that already reads uniquely as Page › Control", () => {
        expect(distinguish([
            row("Save", ["Config"], "Save", ["Rail", "Config"]),
            row("Load", ["Config"], "Load", ["Rail", "Config"]),
        ])).toEqual(["Config › Save", "Config › Load"]);
    });

    // The reported pair: the page's own container and the rail item, both named after the page.
    it("names the group a control is in when another control of the page has its name", () => {
        expect(distinguish([
            row("Config", ["Config"], "Config"),
            row("Config", ["Config"], "Config", ["Rail", "Config"]),
        ])).toEqual(["Config › Config", "Config › Rail › Config"]);
    });

    it("names only as many groups as it takes", () => {
        expect(distinguish([
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
        expect(distinguish([
            row("Name plate", ["Dialogue"], "Name plate", ["Plate"]),
            row("Name plate", ["Dialogue"], "Name plate", ["Plate"], "Widget value"),
        ])).toEqual(["Dialogue › Name plate", "Dialogue › Name plate · Widget value"]);
    });

    it("does not lengthen rows whose titles already differ", () => {
        expect(distinguish([
            row("Open", ["Gallery"], "Cell", ["CG grid"]),
            row("Close", ["Gallery"], "Cell", ["Replay grid"]),
        ])).toEqual(["Gallery › Cell", "Gallery › Cell"]);
    });

    it("keeps no detail for a row with no place", () => {
        expect(distinguish([{ kind: "blueprint", title: "Ghost", details: [] }])).toEqual([undefined]);
    });
});

/** Every other kind of row follows the same rule: say more only where two rows would read the same. */
describe("quick open detail lines of every kind", () => {
    const scene = (title: string, story: string, chapter?: string): QuickOpenPlacedRow => ({
        kind: "scene",
        title,
        details: chapter ? [story, `${story} › ${chapter}`] : [story],
    });
    const asset = (title: string, type: string, folder?: string): QuickOpenPlacedRow => ({
        kind: "asset",
        title,
        details: folder ? [type, `${type} · ${folder}`] : [type],
    });
    const character = (title: string, group?: string): QuickOpenPlacedRow => ({
        kind: "character",
        title,
        details: group ? [undefined, group] : [],
    });

    it("leaves rows of different kinds as they are, since each shows its kind", () => {
        expect(distinguish([
            scene("Corridor", "Main", "Chapter 1"),
            asset("Corridor", "Image", "Backgrounds"),
            character("Corridor", "Cast"),
        ])).toEqual(["Main", "Image", undefined]);
    });

    it("names the chapter of a scene whose story has another scene of its name", () => {
        expect(distinguish([
            scene("Corridor", "Main", "Chapter 1"),
            scene("Corridor", "Main", "Chapter 2"),
            scene("Club room", "Main", "Chapter 1"),
        ])).toEqual(["Main › Chapter 1", "Main › Chapter 2", "Main"]);
    });

    it("names the folder of an asset when another of its type has its name", () => {
        expect(distinguish([
            asset("bg", "Image", "Backgrounds"),
            asset("bg", "Image", "Backgrounds › Indoors"),
            asset("bg", "Audio", "Sounds"),
        ])).toEqual(["Image · Backgrounds", "Image · Backgrounds › Indoors", "Audio"]);
    });

    it("names the group of a character that shares its name with another", () => {
        expect(distinguish([character("Aoi"), character("Aoi", "Extras")])).toEqual([undefined, "Extras"]);
    });

    it("numbers rows that read alike once there is nothing left to say, in the order they were given", () => {
        expect(distinguish([
            asset("click", "Audio", "UI sounds"),
            asset("hover", "Audio", "UI sounds"),
            asset("click", "Audio", "UI sounds"),
            character("Aoi"),
            character("Aoi"),
        ])).toEqual(["Audio · UI sounds · #1", "Audio", "Audio · UI sounds · #2", "#1", "#2"]);
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
                    kind: "blueprint",
                    title: blueprintDisplayName(blueprint, t),
                    details: blueprintPlaceDetails(placePath ? { path: placePath, suffix: owner.kind === "widgetValue" ? "value" : undefined } : undefined),
                });
            }
            expect(rows.length).toBeGreaterThan(50);
            // Numbering is the last resort, so a template row that needs it is a template row that
            // reads like another one.
            const numberedRows: string[] = [];
            const details = distinguishQuickOpenDetails(rows, (detail, ordinal) => {
                numberedRows.push(`${detail ?? ""} #${ordinal}`);
                return numbered(detail, ordinal);
            });
            expect(numberedRows).toEqual([]);
            const read2 = rows.map((entry, index) => `${entry.title} | ${details[index] ?? ""}`);
            const repeated = read2.filter((text, index) => read2.indexOf(text) !== index);
            expect(repeated).toEqual([]);
        });
    }
});
