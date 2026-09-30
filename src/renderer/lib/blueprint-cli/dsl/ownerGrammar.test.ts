/**
 * Every owner kind survives the text format, and the reader's own hints stay true.
 *
 * `roundTrip.test.ts` next door prints and recompiles every blueprint the shipped skeleton holds,
 * which is the stronger claim about graphs - but the skeleton carries only five of the six owner
 * kinds. It has no `storyAction` at all, so nothing there exercises a story row, its `mode`, or the
 * optional-field path `mode` is the only user of. This file covers the owner line itself, one case
 * per kind, written out by hand so the expected text is not produced by the code under test.
 *
 * The hint case is a regression. `sharedAsset` was removed in schema 12 and its `asset=` field with
 * it, but the "unknown field" error went on recommending `asset` - the reader named a word it would
 * then refuse. Both now come off `BLUEPRINT_OWNER_GRAMMAR`, and this asserts they agree.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { compileBlueprintDocument } from "./compile";
import { parseBlueprintText } from "./parse";
import { printBlueprint } from "./print";
import { BLUEPRINT_OWNER_GRAMMAR, blueprintOwnerFieldAliases } from "./ownerGrammar";

registerCoreBlueprintNodes();

/**
 * The built-in surface id, used wherever a surface is named.
 *
 * It carries a colon of its own, which is the trap the whole owner-key format exists to survive: a
 * reader that splits a key or a line on every separator takes `narraleaf-studio` for the surface and
 * loses the rest.
 */
const SURFACE = "narraleaf-studio:main-surface";

type OwnerCase = { name: string; line: string; owner: BlueprintOwnerRef };

const CASES: OwnerCase[] = [
    {
        name: "globalMain",
        line: "owner=globalMain",
        owner: { kind: "globalMain" },
    },
    {
        name: "surfaceMain",
        line: `owner=surfaceMain surface=${SURFACE}`,
        owner: { kind: "surfaceMain", surfaceId: SURFACE },
    },
    {
        name: "widgetMain",
        line: `owner=widgetMain surface=${SURFACE} element=el-1`,
        owner: { kind: "widgetMain", surfaceId: SURFACE, elementId: "el-1" },
    },
    {
        name: "widgetValue",
        line: `owner=widgetValue surface=${SURFACE} element=el-1 prop=label`,
        owner: { kind: "widgetValue", surfaceId: SURFACE, elementId: "el-1", propPath: "label" },
    },
    {
        name: "componentWidgetMain",
        line: "owner=componentWidgetMain component=cmp-1 element=el-1",
        owner: { kind: "componentWidgetMain", componentId: "cmp-1", elementId: "el-1" },
    },
    {
        name: "storyAction with no mode",
        line: "owner=storyAction blueprint=bp-1",
        owner: { kind: "storyAction", blueprintId: "bp-1" },
    },
    {
        name: "storyAction in value mode",
        line: "owner=storyAction blueprint=bp-1 mode=value",
        owner: { kind: "storyAction", blueprintId: "bp-1", mode: "value" },
    },
    {
        name: "storyAction in condition mode",
        line: "owner=storyAction blueprint=bp-1 mode=condition",
        owner: { kind: "storyAction", blueprintId: "bp-1", mode: "condition" },
    },
];

function compileOne(line: string) {
    const parsed = parseBlueprintText(`blueprint Probe ${line} id=bp-probe\n`);
    const compiled = compileBlueprintDocument(parsed.document, {
        newId: () => {
            throw new Error("this blueprint names every id it needs");
        },
    });
    const errors = [...parsed.diagnostics, ...compiled.diagnostics].filter(item => item.severity === "error");
    return { blueprint: compiled.blueprints[0], errors: errors.map(item => `${item.code} ${item.message}`) };
}

describe.each(CASES)("an owner line for $name", testCase => {
    it("reads back as the owner it names", () => {
        const { blueprint, errors } = compileOne(testCase.line);

        expect(errors).toEqual([]);
        expect(blueprint?.owner).toEqual(testCase.owner);
    });

    it("prints back to the same line", () => {
        // The direction that matters for `show`: what comes out has to be what `apply` reads. The
        // printer used to answer for an unrecognised kind with `owner=globalMain`, which reads back
        // as a project-wide blueprint rather than as an error.
        const { blueprint } = compileOne(testCase.line);
        expect(blueprint).toBeDefined();

        const printed = printBlueprint(blueprint!).split("\n")[0];
        expect(printed).toBe(`blueprint Probe ${testCase.line} id=bp-probe`);
    });
});

describe("the owner grammar", () => {
    it("covers every kind the union has, which is what the type is for", () => {
        // Not a list to maintain: the record is keyed by the union, so this only states the count
        // out loud. A kind added to `BlueprintOwnerRef` fails to compile in `ownerGrammar.ts` first.
        expect(Object.keys(BLUEPRINT_OWNER_GRAMMAR).sort()).toEqual([
            "componentWidgetMain",
            "globalMain",
            "storyAction",
            "surfaceMain",
            "widgetMain",
            "widgetValue",
        ]);
    });

    it("advertises no field it would then refuse", () => {
        // The `asset=` regression, stated as a property rather than as that one word: every field
        // named in the "unknown field" hint has to be a field the reader accepts.
        const { errors } = compileOne("owner=globalMain nosuchfield=x");
        const parsed = parseBlueprintText("blueprint Probe owner=globalMain nosuchfield=x\n");
        const hint = parsed.diagnostics.find(item => item.code === "dsl.unknown_owner_field")?.hint ?? "";

        expect(errors.length + parsed.diagnostics.length).toBeGreaterThan(0);
        const advertised = hint.replace(/^Known fields:\s*/, "").replace(/\.$/, "").split(", ")
            .filter(name => name !== "owner" && name !== "id");
        expect(advertised.length).toBeGreaterThan(0);

        const accepted = blueprintOwnerFieldAliases();
        expect(advertised.filter(name => !Object.hasOwn(accepted, name.toLowerCase()))).toEqual([]);
    });
});
