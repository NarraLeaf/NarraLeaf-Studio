import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { compileStoryFile } from "./dsl/compile";
import { sameRowContent } from "./dsl/equal";
import { parseStoryFile } from "./dsl/parse";
import { printStoryScene } from "./dsl/print";
import { OPAQUE_PREFIX } from "./dsl/shapes";
import { buildLookups } from "./lookups";
import { buildContext, emptyProjectData, readProjectData, type ProjectData } from "./project";

/**
 * The property the whole format rests on: printing a scene and reading it back gives the scene.
 *
 * Asserted against every scene of the shipped skeleton, which is a real project rather than a
 * fixture - so a command spec that stops printing what it parses fails here rather than in an
 * agent's working copy. The sibling tools carry the same assertion for the same reason.
 *
 * Two things are checked per scene, and they are not the same thing:
 *
 *  - **Every row survives, with its content.** That includes the opaque ones, which is the whole
 *    point of the escape hatch - a row this format cannot spell has to come back byte for byte.
 *  - **A row is the SAME row.** Ids and `textId`s are compared, because a round trip that produced
 *    equivalent rows under fresh ids would have silently unlinked every translation in the scene.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

function skeletonProject(): { data: ProjectData; document: StoryDocument } | null {
    const storiesDir = path.join(SKELETON, "editor", "story", "stories");
    if (!fs.existsSync(storiesDir)) {
        return null;
    }
    const storyId = fs.readdirSync(storiesDir)[0];
    const file = path.join(storiesDir, storyId, "storydoc.json");
    if (!fs.existsSync(file)) {
        return null;
    }
    return {
        data: readProjectData(SKELETON),
        document: JSON.parse(fs.readFileSync(file, "utf8")) as StoryDocument,
    };
}

let minted = 0;

function roundTrip(data: ProjectData, document: StoryDocument, scene: StoryScene) {
    const context = buildContext(data, document, scene);
    const lookups = buildLookups(data, document, scene, context);
    const printed = printStoryScene({
        scene,
        storyName: "test",
        context,
        rowLookups: lookups.rowLookups,
        prose: lookups.prose,
        conditions: lookups.conditions,
    });
    const parsed = parseStoryFile(printed.text);
    const compiled = compileStoryFile({
        ast: parsed.ast,
        existing: scene,
        document,
        contextFor: next => buildContext(data, document, next ?? scene),
        prose: lookups.prose,
        conditions: lookups.conditions,
        // A minted id is marked rather than forbidden: `createBlockForCommand` asks for one on
        // every build, including the ones whose result is immediately replaced by the row's own.
        // What matters is whether a minted id SURVIVES into the scene, which the assertions check.
        mintId: () => `MINTED-${minted++}`,
    });
    return { printed, parseDiagnostics: parsed.diagnostics, compiled };
}

describe("printing a scene and reading it back", () => {
    // The file format is written in the source vocabulary, which is what the CLI pins at startup.
    commandI18nStore.setPreference(false);
    const project = skeletonProject();
    const scenes = Object.values(project?.document.scenes ?? {}) as StoryScene[];

    it("finds the shipped skeleton to test against", () => {
        expect(project).not.toBeNull();
        expect(scenes.length).toBeGreaterThan(0);
    });

    for (const scene of scenes) {
        it(`gives back every row of "${scene.name}", with its identity`, () => {
            const { parseDiagnostics, compiled } = roundTrip(project!.data, project!.document, scene);
            expect(parseDiagnostics).toEqual([]);
            expect(compiled.diagnostics).toEqual([]);
            expect(compiled.scene).not.toBeNull();

            const before = scene.blocks ?? {};
            const after = compiled.scene!.blocks ?? {};
            expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
            expect(compiled.scene!.rootBlockIds).toEqual(scene.rootBlockIds);
            for (const [id, block] of Object.entries(before)) {
                expect(sameRowContent(after[id], block), `row ${id}`).toBe(true);
                expect(after[id].childrenIds, `children of ${id}`).toEqual(block.childrenIds);
            }
            // No minted id reached the scene: every row, and every `textId` inside one, is the one
            // the document already had. A round trip that renewed a `textId` would have unlinked
            // every translation of that line with nothing recording what it was.
            expect(JSON.stringify(compiled.scene)).not.toContain("MINTED-");
        });
    }

    it("keeps an unedited row byte for byte, not merely equivalent", () => {
        // What stops a one-line edit from rewriting the key order of every row in the document and
        // turning a two-word change into a scene-wide diff.
        const scene = scenes[0];
        const { compiled } = roundTrip(project!.data, project!.document, scene);
        for (const [id, block] of Object.entries(scene.blocks ?? {})) {
            expect(JSON.stringify(compiled.scene!.blocks[id]), `row ${id}`).toBe(JSON.stringify(block));
        }
    });

    it("writes an opaque line for a row it cannot spell, and nothing else", () => {
        // The escape hatch is only sound if a `»` line always has a payload behind it: an opaque
        // line with nothing in `#data` is a row that would vanish on apply.
        for (const scene of scenes) {
            const { printed } = roundTrip(project!.data, project!.document, scene);
            const parsed = parseStoryFile(printed.text);
            const opaque = parsed.ast.lines.filter(line => line.shape === "opaque");
            expect(opaque.length).toBe(printed.stats.opaque);
            for (const line of opaque) {
                expect(line.anchorId, "an opaque line carries an anchor").not.toBeNull();
                expect(parsed.ast.data[line.anchorId!], `#data for ${line.anchorId}`).toBeDefined();
            }
            expect(printed.text.split("\n").filter(line => line.trimStart().startsWith(OPAQUE_PREFIX)).length)
                .toBe(printed.stats.opaque);
        }
    });

    it("never spells a row it would read back as something else", () => {
        // The echo check, stated as the property it exists to guarantee rather than as the mechanism:
        // every line the printer wrote rebuilds to the row it came from. A regression here is a file
        // whose lines look editable and silently drop what the spelling missed.
        for (const scene of scenes) {
            const { compiled } = roundTrip(project!.data, project!.document, scene);
            for (const [id, block] of Object.entries(scene.blocks ?? {})) {
                expect(sameRowContent(compiled.scene!.blocks[id], block), `${scene.name} row ${id}`).toBe(true);
            }
        }
    });
});

describe("a project this tool cannot read", () => {
    it("resolves no names rather than guessing at them", () => {
        // An empty project is a real state - `story command` answers with no `--project` at all - and
        // the context built from one has to be usable rather than throw.
        const context = buildContext(emptyProjectData(), null, null);
        expect(context.characters).toEqual([]);
        expect(context.images).toEqual([]);
    });
});
