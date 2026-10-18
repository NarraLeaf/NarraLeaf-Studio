/**
 * A story row that runs a blueprint - including a plugin's node, such as an achievement unlock - as
 * the agent guide teaches it (`story-format.md`, "A row that runs a blueprint"): a `»` line with a
 * fresh anchor and a `#data` entry naming the row's Story Action Blueprint, and that blueprint
 * written with `owner=storyAction`. Both halves are checked here so the recipe in the guide cannot
 * drift from what the two formats accept.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { buildBlueprintProjectContext, checkBlueprintSource, ensureCoreBlueprintNodes } from "@/lib/agent-core/blueprint";
import { compileStoryFile } from "./dsl/compile";
import { parseStoryFile } from "./dsl/parse";
import { printStoryScene } from "./dsl/print";
import { STORY_FILE_FORMAT_VERSION } from "./dsl/shapes";
import { buildLookups } from "./lookups";
import { buildContext, readProjectData } from "./project";

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");
const ROW_ID = "5a1f0c2e-7b3d-4e8a-9c61-2f4d8e0b7a13";
const BLUEPRINT_ID = "c0ffee00-1d2e-4f3a-8b4c-5d6e7f8091a2";

describe("a story row that runs a blueprint", () => {
    it("is written as an opaque line plus #data, and reads back as the same row", () => {
        const storiesDir = path.join(SKELETON, "editor", "story", "stories");
        const storyId = fs.readdirSync(storiesDir)[0];
        const document = JSON.parse(fs.readFileSync(path.join(storiesDir, storyId, "storydoc.json"), "utf8")) as StoryDocument;
        const data = {
            ...readProjectData(SKELETON),
            blueprintDocument: {
                blueprints: { [BLUEPRINT_ID]: { id: BLUEPRINT_ID, name: "Grant: reached the lighthouse", owner: { kind: "storyAction", blueprintId: BLUEPRINT_ID } } },
                ownerRecords: {},
            } as never,
        };
        const scene = { id: "scene-test", name: "Test", rootBlockIds: [], blocks: {} } as unknown as StoryDocument["scenes"][string];
        const context = buildContext(data, document, scene);
        const lookups = buildLookups(data, document, scene, context);
        const source = [
            `#nlstory ${STORY_FILE_FORMAT_VERSION}`,
            "#story  Main",
            "#scene  Test",
            "",
            "Mei: We made it.",
            `» Blueprint  ⟦${ROW_ID.slice(0, 8)}⟧`,
            "",
            "#data",
            JSON.stringify({
                [ROW_ID.slice(0, 8)]: {
                    id: ROW_ID,
                    parentId: null,
                    childrenIds: [],
                    kind: "action",
                    payload: { action: "blueprint", blueprintId: BLUEPRINT_ID },
                },
            }),
        ].join("\n");
        const parsed = parseStoryFile(source);
        expect(parsed.diagnostics.filter(item => item.severity === "error")).toEqual([]);
        const compiled = compileStoryFile({
            ast: parsed.ast,
            existing: scene,
            document,
            contextFor: () => context,
            prose: lookups.prose,
            conditions: lookups.conditions,
            mintId: (() => { let n = 0; return () => `minted-${n++}`; })(),
        });
        expect(compiled.diagnostics.filter(item => item.severity === "error")).toEqual([]);
        expect(compiled.scene!.blocks[ROW_ID]).toMatchObject({ kind: "action", payload: { action: "blueprint", blueprintId: BLUEPRINT_ID } });

        const printed = printStoryScene({
            scene: compiled.scene!,
            storyName: "test",
            context,
            rowLookups: lookups.rowLookups,
            prose: lookups.prose,
            conditions: lookups.conditions,
        });
        // The line names the blueprint it runs, so a reader can tell two such rows apart.
        expect(printed.text).toMatch(new RegExp(`» Blueprint Grant\\\\?: reached the lighthouse +⟦${ROW_ID.slice(0, 8)}⟧`));
        expect(printed.text).toContain(BLUEPRINT_ID);
    });

    it("has its blueprint written with owner=storyAction and an On Call head", () => {
        ensureCoreBlueprintNodes();
        const source = [
            `blueprint "Grant: reached the lighthouse" owner=storyAction blueprint=${BLUEPRINT_ID} id=${BLUEPRINT_ID}`,
            "",
            "event \"Grant the achievement\"",
            "    call: blueprint.event.head.onCall",
            "    note: blueprint.log",
            "    call.then -> note.in",
        ].join("\n");
        const result = checkBlueprintSource(source, buildBlueprintProjectContext({
            blueprintDocument: { schemaVersion: 1, blueprints: {}, ownerRecords: {} } as never,
            uiDocument: null,
        }));
        expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.blueprints[0]).toMatchObject({ id: BLUEPRINT_ID, owner: { kind: "storyAction", blueprintId: BLUEPRINT_ID } });
    });
});
