import { describe, expect, it } from "vitest";
import type { SectionFieldDefinition, TextFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { uiTextSitesOf, withUITextSitesResolved } from "@shared/types/ui-editor/textSource";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_INPUT_HINT_WORDS, uiInputHintLabelKeyProp, uiInputHintLabelProp } from "@shared/types/ui-editor/inputHints";
import { createInputHintsInspector } from "./inspector";

describe("input hint word editing", () => {
    it.each(UI_INPUT_HINT_WORDS)("shows the author's edited %s word when it previously used a key", word => {
        const label = uiInputHintLabelProp(word);
        const key = uiInputHintLabelKeyProp(word);
        const element: UIElement = {
            id: "hints",
            type: "nl.inputHints",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 500, height: 48 },
            props: { [key]: "menu.word", color: "#ffffff" },
        };
        const document = { elements: { hints: element } };
        const documentService = {
            getDocument: () => document,
            updateElementProps: (_id: string, patch: Record<string, unknown>) => {
                element.props = { ...element.props, ...patch };
            },
        } as unknown as UIInspectorData["documentService"];
        const data: UIInspectorData = { element, elements: [element], documentService };
        const schema = createInputHintsInspector({ element, documentService });
        const sections = schema.tabs![0]!.fields as SectionFieldDefinition<UIInspectorData>[];
        const words = sections.find(section => section.id === "section.inputHintsWords")!;
        const field = words.fields.find(item => item.id === `inputHints.word.${word}`) as TextFieldDefinition<UIInspectorData>;
        const displayed = () => withUITextSitesResolved(element, uiTextSitesOf(element.type), {
            kind: "canvas",
            keys: { "menu.word": "From key" },
        }).props?.[label];

        expect(displayed()).toBe("From key");
        field.setValue!(data, "Author's words");
        expect(displayed()).toBe("Author's words");
        expect(element.props?.[key]).toBeUndefined();
        expect(element.props?.color).toBe("#ffffff");
    });
});
