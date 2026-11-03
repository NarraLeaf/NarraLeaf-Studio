import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getWidgetTypeParent } from "@shared/types/ui-editor/widgetInheritance";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIWidgetDeclaration, UIWidgetDefaultWords, UIWidgetModule } from "./types";
import { INTERFACE_DEFAULT_WORDS } from "./defaultWords";

export type WidgetDeclarationExtension = {
    type: string;
    displayName(): string;
    icon?: UIWidgetDeclaration["icon"];
    logicApi?: UIWidgetDeclaration["logicApi"];
    defaultElement?(inherited: Partial<UIElement>, words: UIWidgetDefaultWords): Partial<UIElement>;
    createDefaultChildElements?: UIWidgetDeclaration["createDefaultChildElements"];
};

/** Inherit insertion defaults and capabilities without loading either drawing or inspector code. */
export function extendWidgetDeclaration(parent: UIWidgetDeclaration, extension: WidgetDeclarationExtension): UIWidgetDeclaration {
    const declaredParent = getWidgetTypeParent(extension.type);
    if (declaredParent !== parent.type) {
        console.warn(`[widget-modules] ${extension.type} extends ${parent.type} but WIDGET_TYPE_PARENTS says ${declaredParent ?? "nothing"}`);
    }
    return {
        type: extension.type,
        extends: parent.type,
        logicApi: extension.logicApi ?? getWidgetLogicApi(extension.type),
        get displayName() { return extension.displayName(); },
        icon: extension.icon ?? parent.icon,
        createDefaultElement: (words = INTERFACE_DEFAULT_WORDS) => {
            const inherited = { ...parent.createDefaultElement(words), type: extension.type, name: extension.displayName() };
            return extension.defaultElement ? extension.defaultElement(inherited, words) : inherited;
        },
        createDefaultChildElements: extension.createDefaultChildElements ?? parent.createDefaultChildElements,
    };
}

/** Keep live declaration getters when attaching the implementation used by the editor. */
export function defineWidgetModule(
    declaration: UIWidgetDeclaration,
    implementation: Pick<UIWidgetModule, "render"> & Partial<UIWidgetModule>,
): UIWidgetModule {
    return Object.defineProperties({ ...implementation }, Object.getOwnPropertyDescriptors(declaration)) as UIWidgetModule;
}
