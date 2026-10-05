// @vitest-environment jsdom
/**
 * A plugin widget's declared words, in the editor: the host keeps the declaration with the module so
 * every shared reader finds it, draws the text choice for each declared prop in the properties panel,
 * hands the widget its words resolved when it is drawn, and lists them in the translation table.
 */
import React from "react";
import { Box } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { GameLocalizationBundle } from "@shared/types/localization";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { uiTextSitesFromPluginDeclaration, uiTextSitesOf } from "@shared/types/ui-editor/textSource";
import type { FieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { ElementRendererRegistry, type ElementRendererProps } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { GameLocalizationContext } from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { setDesignTimeLocalizationKeys } from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import type { RuntimePluginGame, RuntimeWidgetRendererProps } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import { syncPluginElementRenderers } from "@/lib/ui-editor/widget-modules/pluginElementRenderers";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { extractUiTranslationRows } from "@/lib/workspace/services/localization/localizationModel";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { PluginWidgetModule } from "./pluginWidgetApi";
import { guardInspectorDataForPluginWidget, guardPluginWidgetModule } from "./pluginWidgetGuard";
import { withLiveDocumentService } from "./pluginWidgetHostData";

const OWNER = "acme.badges";
const TYPE = "acme.badges.badge";
const SITES = uiTextSitesFromPluginDeclaration(TYPE, [
    { prop: "caption", keyProp: "captionKey", label: "Caption", localized: { zh: "说明" } },
    { prop: "hint" },
]);

let seen: RuntimeWidgetRendererProps | null = null;

function pluginModule(withInspector: boolean): PluginWidgetModule {
    return {
        type: TYPE,
        displayName: "Badge",
        icon: Box,
        createDefaultElement: () => ({ props: { caption: "Treasure" } }),
        render: props => {
            seen = props;
            return null;
        },
        ...(withInspector
            ? {
                createInspector: () => ({
                    id: "badge.inspector",
                    title: "Badge",
                    fields: [{ id: "badge.tone", type: "text", label: "Tone", getValue: () => "", setValue: () => undefined }],
                }),
            }
            : {}),
    } as PluginWidgetModule;
}

const SERVICES = {
    documentService: {} as UIDocumentService,
    stateService: {} as UIEditorStateService,
};

function registerGuarded(sites = SITES, withInspector = true) {
    const guarded = guardPluginWidgetModule(OWNER, pluginModule(withInspector), {} as RuntimePluginGame, SERVICES, sites);
    widgetModuleRegistry.register(guarded, { ownerPluginId: OWNER, ownerPluginName: "Badges" });
    return guarded;
}

function badge(props: Record<string, unknown>): UIElement {
    return {
        id: "badge-1",
        name: "Badge",
        type: TYPE,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1 },
        props,
    } as UIElement;
}

const SURFACE = {
    id: "surface-1",
    name: "Title",
    host: "app",
    kind: "appSurface",
    designSize: { width: 100, height: 100 },
    rootElementId: "root",
} as UISurface;

function documentWith(element: UIElement): UIDocument {
    const root = { id: "root", type: "nl.root", parentId: null, childrenIds: [element.id], layout: { x: 0, y: 0, width: 100, height: 100 } };
    return { surfaces: [SURFACE], elements: { root, [element.id]: element } } as unknown as UIDocument;
}

function draw(element: UIElement, wrap: (child: React.ReactElement) => React.ReactElement = child => child): void {
    const registry = new ElementRendererRegistry();
    syncPluginElementRenderers(registry);
    const props: ElementRendererProps = { element, surface: SURFACE, document: documentWith(element), hostAdapter: { host: "app" } };
    render(wrap(<>{registry.get(TYPE)!.render(props)}</>));
}

afterEach(() => {
    cleanup();
    widgetModuleRegistry.unregister(TYPE);
    setDesignTimeLocalizationKeys(null);
    seen = null;
});

describe("a plugin widget's declared words in the editor", () => {
    it("keeps the declaration with the module, where every shared reader finds it", () => {
        const guarded = registerGuarded();
        expect(guarded.textSites).toBe(SITES);
        expect(uiTextSitesOf(TYPE)).toEqual(SITES);
        widgetModuleRegistry.unregister(TYPE);
        expect(uiTextSitesOf(TYPE)).toEqual([]);
    });

    it("puts the text choice for each declared prop at the top of the widget's own fields", () => {
        const guarded = registerGuarded();
        const schema = guarded.createInspector!({ element: badge({}), documentService: SERVICES.documentService } as never)!;
        const properties = schema.tabs!.find(tab => tab.id === "properties")!;
        const [section, own] = properties.fields as (FieldDefinition<UIInspectorData> & { fields?: FieldDefinition<UIInspectorData>[] })[];
        expect(section.id).toBe("section.pluginTextContent");
        expect(section.fields!.map(field => [field.id, field.type])).toEqual([
            ["pluginText.caption", "custom"],
            ["pluginText.hint", "custom"],
        ]);
        expect(own.id).toBe("badge.tone");
    });

    it("gives a widget with declared words an inspector even when it declared none, and leaves one without alone", () => {
        expect(registerGuarded(SITES, false).createInspector).toBeTypeOf("function");
        widgetModuleRegistry.unregister(TYPE);
        expect(registerGuarded([], false).createInspector).toBeUndefined();
    });

    it("hands the host's own fields the live document service and the plugin's the narrowed one", () => {
        registerGuarded();
        const live = { getDocument: () => documentWith(badge({})) } as unknown as UIDocumentService;
        const data = guardInspectorDataForPluginWidget({ element: badge({}), elements: [], documentService: live });
        expect(data.documentService).not.toBe(live);
        expect(withLiveDocumentService(data).documentService).toBe(live);
    });

    it("draws a key's source words on the canvas, and the widget's own words as written", () => {
        registerGuarded();
        setDesignTimeLocalizationKeys({ "menu.treasure": "Treasure" });
        draw(badge({ captionKey: "menu.treasure", hint: "Press to open", tone: "gold" }));
        expect(seen?.element.props).toMatchObject({ caption: "Treasure", hint: "Press to open", tone: "gold" });
    });

    it("draws the player's language where a game localization is mounted", () => {
        registerGuarded();
        const bundle: GameLocalizationBundle = {
            sourceLocale: "en",
            locales: [{ code: "en", displayName: "English" }, { code: "zh", displayName: "中文" }],
            tables: { zh: { "key:menu.treasure": "宝箱", "ui:badge-1.hint": "按下打开" } },
            keys: { "menu.treasure": "Treasure" },
        };
        draw(badge({ captionKey: "menu.treasure", hint: "Press to open" }), child => (
            <GameLocalizationContext.Provider value={{ bundle, getLocale: () => "zh", subscribe: () => () => undefined }}>
                {child}
            </GameLocalizationContext.Provider>
        ));
        expect(seen?.element.props).toMatchObject({ caption: "宝箱", hint: "按下打开" });
    });

    it("lists each word-holding prop in the translation table, named by what the plugin calls it", () => {
        registerGuarded();
        const element = badge({ caption: "Treasure", hint: "Press to open", captionKey: "" });
        const rows = extractUiTranslationRows(documentWith(element), { locale: "zh" });
        expect(rows.map(row => [row.unitId, row.elementName, row.groupName, row.sourceText])).toEqual([
            ["ui:badge-1.caption", "Badge › 说明", "Title", "Treasure"],
            ["ui:badge-1.hint", "Badge › hint", "Title", "Press to open"],
        ]);
        // A key's words have the key's row, not the widget's.
        const keyed = badge({ captionKey: "menu.treasure", hint: "Press to open" });
        expect(extractUiTranslationRows(documentWith(keyed)).map(row => row.unitId))
            .toEqual(["ui:badge-1.hint"]);
    });
});
