import { describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { getWidgetTypeParent } from "@shared/types/ui-editor/widgetInheritance";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type {
    FieldDefinition,
    PropertyEditorSchema,
    SectionFieldDefinition,
} from "@/apps/workspace/modules/properties/framework/types";
import { BuiltinWidgetModules } from "./builtin";
import { TextWidgetModule } from "./builtin/text";
import { DialogSentenceWidgetModule } from "./builtin/dialog";
import { NvlTextsWidgetModule } from "./builtin/nvl";
import { ChoiceListWidgetModule } from "./builtin/choiceList";
import { ListWidgetModule } from "./builtin/list";
import { applyInspectorOverrides, extendWidgetModule } from "./inheritance";
import type { InspectorContext, UIInspectorData, UIWidgetModule } from "./types";

function inspectorContext(element: Partial<UIElement>, id = "el-1"): InspectorContext {
    const live = { id, childrenIds: [], parentId: null, ...element } as UIElement;
    return {
        element: live,
        documentService: {
            getDocument: () => ({ elements: { [id]: live } }),
        } as unknown as InspectorContext["documentService"],
    };
}

function collectFieldIds(fields: FieldDefinition<UIInspectorData>[]): string[] {
    const ids: string[] = [];
    for (const field of fields) {
        ids.push(field.id);
        if (field.type === "section") {
            ids.push(...collectFieldIds((field as SectionFieldDefinition<UIInspectorData>).fields));
        }
    }
    return ids;
}

function allFieldIds(schema: PropertyEditorSchema<UIInspectorData> | undefined): string[] {
    if (!schema) {
        return [];
    }
    return [...collectFieldIds(schema.fields), ...(schema.tabs ?? []).flatMap(tab => collectFieldIds(tab.fields))];
}

function findField(
    schema: PropertyEditorSchema<UIInspectorData> | undefined,
    id: string,
): FieldDefinition<UIInspectorData> | undefined {
    const walk = (fields: FieldDefinition<UIInspectorData>[]): FieldDefinition<UIInspectorData> | undefined => {
        for (const field of fields) {
            if (field.id === id) {
                return field;
            }
            if (field.type === "section") {
                const nested = walk((field as SectionFieldDefinition<UIInspectorData>).fields);
                if (nested) {
                    return nested;
                }
            }
        }
        return undefined;
    };
    return walk([...(schema?.fields ?? []), ...(schema?.tabs ?? []).flatMap(tab => tab.fields)]);
}

describe("widget module inheritance", () => {
    it("declares the same parent as the shared type table", () => {
        for (const module of BuiltinWidgetModules) {
            expect(module.extends, `${module.type} module link`).toBe(getWidgetTypeParent(module.type));
        }
    });

    it("inherits the parent's default props and patches only what it restates", () => {
        const parent = TextWidgetModule.createDefaultElement();
        const child = DialogSentenceWidgetModule.createDefaultElement();
        const parentProps = parent.props as Record<string, unknown>;
        const childProps = child.props as Record<string, unknown>;

        expect(child.type).toBe("nl.dialog.sentence");
        expect(child.name).toBe(DialogSentenceWidgetModule.displayName);
        expect(childProps.fontSize).toBe(24);
        expect(childProps.lineHeight).toBe(1.45);
        // Inherited without being restated - the whole point of the mechanism.
        expect(childProps.textWrapMode).toBe(parentProps.textWrapMode);
        expect(childProps.textVerticalAlign).toBe(parentProps.textVerticalAlign);
        expect(childProps.writingMode).toBe(parentProps.writingMode);
        expect(child.layout?.width).toBe(560);
    });

    it("rebuilds the appearance snapshot from the patched props", () => {
        const child = NvlTextsWidgetModule.createDefaultElement();
        const appearance = (child.props as { appearance: AppearanceModel }).appearance;
        const fontSizeGroup = appearance.variants[0]?.propertyGroups.find(group => group.key === "fontSize");
        expect(fontSizeGroup?.rows[0]?.value).toBe(22);
    });

    it("deep-copies nested list defaults so two inserted lists do not share a scrollbar", () => {
        const first = ChoiceListWidgetModule.createDefaultElement().props as { scrollbar: { enabled: boolean } };
        const second = ChoiceListWidgetModule.createDefaultElement().props as { scrollbar: { enabled: boolean } };
        const parent = ListWidgetModule.createDefaultElement().props as { scrollbar: { enabled: boolean } };
        expect(first.scrollbar).not.toBe(second.scrollbar);
        expect(first.scrollbar.enabled).toBe(false);
        expect(parent.scrollbar.enabled).toBe(true);
    });

    it("inherits the parent inspector and applies the child's edits", () => {
        const element = { ...DialogSentenceWidgetModule.createDefaultElement(), id: "el-1" } as UIElement;
        const inherited = TextWidgetModule.createInspector?.(inspectorContext(element));
        const schema = DialogSentenceWidgetModule.createInspector?.(inspectorContext(element));

        expect(schema?.id).toBe("ui-inspector:nl.dialog.sentence:el-1");
        expect(allFieldIds(inherited)).toContain("section.localization");
        expect(allFieldIds(schema)).not.toContain("section.localization");
        expect(allFieldIds(schema)).not.toContain("text.localizable");
        // Everything else the parent offers is still there, unrestated.
        expect(allFieldIds(schema)).toContain("section.typography");
        expect(allFieldIds(schema)).toContain("text.appearance.panel");
        expect(findField(schema, "section.content")?.helpText).toBeTruthy();
        expect(findField(inherited, "section.content")?.helpText).toBeUndefined();
    });

    it("warns when a module claims a parent the shared table does not know", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            extendWidgetModule(TextWidgetModule, {
                type: "nl.notARegisteredChild",
                displayName: () => "Unregistered",
            });
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("WIDGET_TYPE_PARENTS"));
        } finally {
            warn.mockRestore();
        }
    });
});

describe("applyInspectorOverrides", () => {
    const baseSchema = (): PropertyEditorSchema<UIInspectorData> => ({
        id: "base",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    {
                        id: "section.a",
                        type: "section",
                        title: "A",
                        fields: [
                            { id: "a.one", type: "info", items: [] },
                            { id: "a.two", type: "info", items: [] },
                        ],
                    } as FieldDefinition<UIInspectorData>,
                ],
            },
        ],
    });

    const marker = (id: string): FieldDefinition<UIInspectorData> =>
        ({ id, type: "info", items: [] }) as FieldDefinition<UIInspectorData>;

    it("inserts at a named anchor and falls back to appending", () => {
        const afterOne = applyInspectorOverrides(
            baseSchema(),
            { insert: [{ target: "section.a", position: { after: "a.one" }, fields: [marker("a.inserted")] }] },
            { id: "child" },
        );
        const section = afterOne.tabs?.[0]?.fields[0] as SectionFieldDefinition<UIInspectorData>;
        expect(section.fields.map(field => field.id)).toEqual(["a.one", "a.inserted", "a.two"]);

        const missingAnchor = applyInspectorOverrides(
            baseSchema(),
            { insert: [{ target: "section.a", position: { after: "a.gone" }, fields: [marker("a.inserted")] }] },
            { id: "child" },
        );
        const appended = missingAnchor.tabs?.[0]?.fields[0] as SectionFieldDefinition<UIInspectorData>;
        expect(appended.fields.map(field => field.id)).toEqual(["a.one", "a.two", "a.inserted"]);
    });

    it("appends to a tab and adds new tabs", () => {
        const next = applyInspectorOverrides(
            baseSchema(),
            {
                insert: [{ target: "properties", into: "tab", fields: [marker("tab.extra")] }],
                addTabs: [{ id: "extra", title: "Extra", fields: [] }],
            },
            { id: "child" },
        );
        expect(next.tabs?.[0]?.fields.map(field => field.id)).toEqual(["section.a", "tab.extra"]);
        expect(next.tabs?.[1]?.id).toBe("extra");
    });

    it("reports ids the inherited schema no longer has", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            applyInspectorOverrides(
                baseSchema(),
                { remove: ["a.renamed"], patch: { "a.one": { label: "One" } }, insert: [{ target: "section.gone", fields: [] }] },
                { id: "child", label: "nl.child" },
            );
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("no field a.renamed"));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("no section section.gone"));
        } finally {
            warn.mockRestore();
        }
    });
});
