import { beforeAll, describe, expect, it } from "vitest";
import { UI_TEXT_WRITE_NODES } from "@shared/types/ui-editor/textWriters";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";

/**
 * The writer scan's table of word-writing nodes (`@shared/types/ui-editor/textWriters`) against the
 * node registry the editor and the game use.
 *
 * The table lives in `@shared` so the package builder can read it, which is out of the registry's
 * reach; this is what keeps the two from drifting. A node renamed in the registry, or a pin moved,
 * fails here instead of quietly dropping out of every inspector's list of writers - and a new node
 * that writes a widget's words, named the way the existing ones are, fails until the table knows it.
 */
describe("UI_TEXT_WRITE_NODES", () => {
    beforeAll(() => {
        registerCoreBlueprintNodes();
    });

    it("names only registered nodes, with the pins the scan reads", () => {
        for (const entry of UI_TEXT_WRITE_NODES) {
            const def = blueprintNodeRegistry.get(entry.nodeType);
            expect(def, entry.nodeType).toBeDefined();
            const inputs = new Set((def?.pins ?? []).filter(pin => pin.kind === "input").map(pin => pin.id));
            expect(inputs.has("element"), `${entry.nodeType} element pin`).toBe(entry.target === "element");
            if (entry.wordsPin) {
                expect(inputs.has(entry.wordsPin), `${entry.nodeType} words pin`).toBe(true);
            }
        }
    });

    it("knows every registered node that writes a text's or a button's words", () => {
        const writes = /^blueprint\.(element\.)?(text\.(setText|appendText|clearText|setAllProperties)|button\.setLabel)$/;
        const registered = blueprintNodeRegistry.list().map(def => def.type).filter(type => writes.test(type)).sort();
        expect(registered).toEqual(UI_TEXT_WRITE_NODES.map(entry => entry.nodeType).sort());
    });
});
