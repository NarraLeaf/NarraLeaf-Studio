import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryDocument, StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { describeCommand, formatCommandDetail } from "./catalog";
import { compileStoryFile } from "./dsl/compile";
import { parseStoryFile } from "./dsl/parse";
import { printStoryScene } from "./dsl/print";
import { buildLookups } from "./lookups";
import { buildContext, readProjectData, type ProjectData } from "./project";

/**
 * What `story command` lists is what a file may write.
 *
 * Each case here is a line the catalogue offered and the compiler refused (Studio 1.6.3): `/show`
 * listed `opacity=` and refused it, `/font` listed a size and a colour and refused the pair, and the
 * refusals named the parameter as `""`. A line the catalogue offers must compile, print back, and
 * compile again to the same row; a line it qualifies must be refused with the parameter named.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

function project(): { data: ProjectData; document: StoryDocument; scene: StoryScene } {
    commandI18nStore.setPreference(false);
    const storiesDir = path.join(SKELETON, "editor", "story", "stories");
    const storyId = fs.readdirSync(storiesDir)[0];
    const document = JSON.parse(fs.readFileSync(path.join(storiesDir, storyId, "storydoc.json"), "utf8")) as StoryDocument;
    const scene = { ...(Object.values(document.scenes)[0] as StoryScene), rootBlockIds: [], blocks: {} };
    return { data: readProjectData(SKELETON), document, scene };
}

function compileLines(lines: readonly string[]) {
    const { data, document, scene } = project();
    const lookups = buildLookups(data, document, scene, buildContext(data, document, scene));
    const source = `#nlstory 1\n#scene ${scene.name} ⟦${scene.id}⟧\n\n${lines.join("\n")}\n`;
    let next = 0;
    const compiled = compileStoryFile({
        ast: parseStoryFile(source).ast,
        existing: scene,
        document,
        contextFor: stage => buildContext(data, document, stage ?? scene),
        prose: lookups.prose,
        conditions: lookups.conditions,
        mintId: () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
    });
    return { ...compiled, data, document };
}

/** The command lines `story show` prints for a compiled scene, without the header and anchors. */
function printed(data: ProjectData, document: StoryDocument, scene: StoryScene): string[] {
    const context = buildContext(data, document, scene);
    const lookups = buildLookups(data, document, scene, context);
    const text = printStoryScene({
        scene,
        storyName: "test",
        context,
        rowLookups: lookups.rowLookups,
        prose: lookups.prose,
        conditions: lookups.conditions,
    }).text;
    return text.split("\n").filter(line => line.startsWith("/")).map(line => line.replace(/\s+⟦[^⟧]*⟧\s*$/, "").trim());
}

function payloads(scene: StoryScene): StoryActionPayload[] {
    return scene.rootBlockIds.map(id => scene.blocks[id].payload as StoryActionPayload);
}

/** Compile, print, compile the print: the second scene must hold the same payloads as the first. */
function roundTrips(lines: readonly string[]) {
    const first = compileLines(lines);
    expect(first.diagnostics).toEqual([]);
    const lines2 = printed(first.data, first.document, first.scene!);
    const second = compileLines(lines2);
    expect(second.diagnostics).toEqual([]);
    expect(payloads(second.scene!)).toEqual(payloads(first.scene!));
    return { scene: first.scene!, printed: lines2 };
}

describe("/show opacity=", () => {
    it("is accepted on a character, with and without pos=, and ends the entrance at that opacity", () => {
        const { scene, printed: lines } = roundTrips([
            "/show Narra pos=0.5,0.5 yoffset=-451 opacity=0",
            "/show Aoi opacity=0.4",
        ]);
        const [placed, bare] = payloads(scene) as Extract<StoryActionPayload, { action: "character" }>[];
        expect(placed.transform?.to?.opacity).toBe(0);
        expect(placed.transform?.to?.position).toMatchObject({ xalign: 0.5, yalign: 0.5, yoffset: -451 });
        expect(bare.transform?.to?.opacity).toBe(0.4);
        expect(lines[0]).toContain("opacity=0");
        expect(lines[1]).toContain("opacity=0.4");
    });

    it("overrides the opacity a reveal word writes, rather than being replaced by it", () => {
        const { scene } = roundTrips(["/show Narra in=fade d=1 opacity=0.5"]);
        const [row] = payloads(scene) as Extract<StoryActionPayload, { action: "character" }>[];
        expect(row.transform).toMatchObject({ to: { opacity: 0.5 }, durationMs: 1000 });
    });

    it("is accepted on a text object", () => {
        const { scene } = roundTrips(["/text name=credit Staff", "/show credit opacity=0.25"]);
        const shown = payloads(scene)[1] as Extract<StoryActionPayload, { action: "text" }>;
        expect(shown.operation).toBe("show");
        expect(shown.transform?.to?.opacity).toBe(0.25);
    });

    it("still refuses rate= off an ambience overlay, naming the parameter", () => {
        const { diagnostics } = compileLines(["/show Narra rate=2"]);
        expect(diagnostics.map(d => d.code)).toEqual(["compile.unsupportedParam"]);
        expect(diagnostics[0].message).toContain("\"rate=\" does not apply to this character");
    });

    it("is described in the catalogue as the entrance's opacity, and rate= as overlay-only", () => {
        const detail = formatCommandDetail(describeCommand("show")!);
        expect(detail).toMatch(/opacity=[^\n]*\n\s+The opacity the subject appears at/);
        expect(detail).toMatch(/rate=[^\n]*\n\s+Ambience overlays only/);
    });
});

describe("/font", () => {
    it("sets a size and a colour on one row", () => {
        const { scene, printed: lines } = roundTrips(["/text name=credit_role Staff", "/font credit_role 48 color=#FFFFFF"]);
        const font = payloads(scene)[1] as Extract<StoryActionPayload, { action: "text" }>;
        expect(font).toMatchObject({ operation: "setFont", fontSize: 48, fontColor: "#FFFFFF" });
        expect(font.outline).toBeUndefined();
        expect(lines[1]).toBe("/font credit_role 48 color=#FFFFFF");
    });

    it("keeps the single ops for a line that names one value", () => {
        const { scene } = roundTrips(["/text name=t Staff", "/font t 24", "/font t color=#ffcc00"]);
        const [, size, color] = payloads(scene) as Extract<StoryActionPayload, { action: "text" }>[];
        expect(size).toMatchObject({ operation: "setFontSize", fontSize: 24 });
        expect(color).toMatchObject({ operation: "setFontColor", fontColor: "#ffcc00" });
    });

    it("draws an outline, and takes one away with outline=0", () => {
        const { scene, printed: lines } = roundTrips([
            "/text name=credit Staff",
            "/font credit color=#FFFFFF outline=1 outlineColor=#332e3e",
            "/font credit outline=2",
            "/font credit outlineColor=#ff0000",
            "/font credit outline=0",
        ]);
        const [, ported, wide, coloured, cleared] = payloads(scene) as Extract<StoryActionPayload, { action: "text" }>[];
        expect(ported).toMatchObject({ operation: "setFont", fontColor: "#FFFFFF", outline: { width: 1, color: "#332e3e" } });
        expect(wide.outline).toEqual({ width: 2, color: "#000000" });
        expect(coloured.outline).toEqual({ width: 1, color: "#ff0000" });
        expect(cleared).toMatchObject({ operation: "setFont", outline: null });
        expect(lines[1]).toBe("/font credit color=#FFFFFF outline=1 outlineColor=#332e3e");
        expect(lines[4]).toBe("/font credit outline=0");
    });
});

describe("/swap on a text object", () => {
    it("refuses t= and d= naming each, and the catalogue says they are an image's alone", () => {
        const { diagnostics } = compileLines(["/text name=credit Staff", "/swap credit t=fade d=1 New words"]);
        expect(diagnostics.map(d => d.code)).toEqual(["compile.unsupportedParam", "compile.unsupportedParam"]);
        expect(diagnostics[0].message).toContain("\"t=\" does not apply to this text object");
        expect(diagnostics[1].message).toContain("\"d=\" does not apply to this text object");
        const detail = formatCommandDetail(describeCommand("swap")!);
        expect(detail).toMatch(/t=[^\n]*\n\s+Image targets only/);
        expect(detail).toMatch(/d=[^\n]*\n\s+Image targets only/);
    });

    it("swaps the words as a cut", () => {
        const { scene } = roundTrips(["/text name=credit Staff", "/swap credit New words"]);
        expect(payloads(scene)[1]).toMatchObject({ action: "text", operation: "setText", text: "New words" });
    });
});

describe("a refusal names what it refuses", () => {
    it("never reports a parameter as an empty string", () => {
        const { diagnostics } = compileLines([
            "/text name=credit Staff",
            "/swap credit t=fade New words",
            "/show Narra rate=2",
            "/transform Narra loop=true stopLoop=true",
        ]);
        expect(diagnostics.length).toBeGreaterThan(0);
        for (const diagnostic of diagnostics) {
            expect(diagnostic.message, diagnostic.code).not.toMatch(/: ""/);
        }
    });
});
