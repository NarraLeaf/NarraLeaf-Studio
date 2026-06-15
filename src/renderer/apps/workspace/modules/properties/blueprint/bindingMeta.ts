import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

export type PropertyFieldBindingMeta = {
    /** Path on `UIElement.props` (top-level key for M4). */
    propPath: string;
    /** Current literal from the document when creating a binding (persisted as fallback). */
    readLiteral: (data: UIInspectorData) => string | number | boolean | null;
};

export function isUIInspectorData(data: unknown): data is UIInspectorData {
    return Boolean(
        data &&
            typeof data === "object" &&
            "element" in data &&
            "elements" in data &&
            "documentService" in data &&
            (data as UIInspectorData).element &&
            typeof (data as UIInspectorData).element.id === "string",
    );
}
