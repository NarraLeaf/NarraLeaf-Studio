/**
 * Typing the pins did not turn a single wire of the shipped templates red.
 *
 * Get Field declared `any` for as long as it only read list rows, and the templates wire it into
 * `json` and `string` pins - a confirm page's button index into Close Self's result, for one. Its
 * output is now typed by the field it reads, and the array nodes pass item types along; a wire the
 * declared types accepted has to stay accepted, or every project made from a template opens with an
 * error on a graph nobody touched. Checked the way `blueprint check --project` checks a project, over
 * every language the template ships in.
 */

import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { registerBuiltInPluginBlueprintNodes } from "./builtinPluginNodes";
import { checkProjectDocument } from "./check";
import { readUiDocumentTargets, readUiGraphs, readVariableRegistry, widgetElementResolver } from "./project";

const TEMPLATE_ROOT = path.resolve(__dirname, "../../../../resources/templates/skeleton");

/** The findings this work could have introduced into a graph that was fine. */
const STRUCT_TYPE_CODES = new Set([
    "edge.connection_invalid",
    "node.field_missing",
    "node.field_unpicked",
    "node.key_not_a_field",
    "node.input_missing",
]);

beforeAll(() => {
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
});

describe.each(["content", "content.zh", "content.ja"])("the skeleton template (%s)", folder => {
    it("checks clean of every wire and field finding", () => {
        const projectDir = path.join(TEMPLATE_ROOT, folder);
        const targets = readUiDocumentTargets(projectDir);
        const variables = readVariableRegistry(projectDir);
        const findings = checkProjectDocument(readUiGraphs(projectDir).blueprintDocument, {
            persistentVariables: variables.persistent,
            savedVariables: variables.saved,
            resolveWidgetElement: widgetElementResolver(targets),
            uiElements: targets.raw as Readonly<Record<string, UIElement>>,
            uiStructs: targets.structs,
        });
        expect(findings.filter(finding => STRUCT_TYPE_CODES.has(finding.code))).toEqual([]);
    });
});
