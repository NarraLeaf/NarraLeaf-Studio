import { describe, expect, it } from "vitest";
import { renderProjectDeclarations } from "@shared/project/scriptDeclarations";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "../../services";
import { collectScriptProjectFacts } from "./scriptDeclarationFiles";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, name: id, parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 40 } };
}

describe("project script declarations", () => {
    it("collects component widgets from their own definition and renders their context aliases", () => {
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [],
            elements: {},
            components: [{
                id: "card",
                name: "Card",
                rootElementId: "frame",
                elements: {
                    frame: element("frame", "nl.container", null, ["button"]),
                    button: element("button", "nl.button", "frame"),
                },
            }],
        };
        const services: Record<string, unknown> = {
            [Services.UIDocument]: { getDocument: () => document },
            [Services.Character]: { listCharacter: () => [] },
            [Services.Story]: { listStories: () => [] },
            [Services.VariableRegistry]: { listEntriesInScope: () => [] },
            [Services.AudioTracks]: { tracksOrNull: () => [] },
            [Services.Localization]: { getConfiguration: () => ({ locales: [] }) },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        const facts = collectScriptProjectFacts(context);

        expect(facts.components[0].elements.map(item => item.id)).toEqual(["frame", "button"]);
        expect(renderProjectDeclarations(facts)).toContain('type CardButtonCtx = ComponentWidgetCtx<"nl.button">;');
    });
});
