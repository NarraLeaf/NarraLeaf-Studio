import { UIElement } from "@shared/types/ui-editor/document";

export type ElementTypeDefinition = {
    type: string;
    displayName: string;
    createDefaultElement: () => Partial<UIElement>;
};
