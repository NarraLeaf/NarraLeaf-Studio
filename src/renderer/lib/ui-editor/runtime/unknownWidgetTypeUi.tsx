import React, { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * The block drawn where a widget could not be.
 *
 * Two states share it, because they are one thing to an author looking at a page: the type is not
 * loaded at all, or its renderer threw. Both leave a hole where an element was placed, and both
 * name the type - which is the part that says which plugin is missing or at fault, and the part an
 * author can act on. The element id never appears: it is a generated id, and it is not something
 * anyone can look up.
 *
 * Deliberately the same vocabulary the blueprint canvas uses for a node whose type is not
 * registered - a dashed warning frame, a warning triangle, a short badge and the raw type string in
 * a monospace face - so that "the plugin that defined this is not here" reads the same in both
 * editors.
 */
function WidgetProblemBlock({
    label,
    type,
    children,
}: {
    label: string;
    type: string;
    children?: ReactNode;
}): React.ReactElement {
    return (
        <div
            className="flex flex-col min-h-[20px] w-full h-full box-border border-2 border-dashed border-warning/55 bg-warning/10 overflow-hidden"
            data-tip={type}
        >
            <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-2xs leading-tight text-warning bg-warning/20 font-medium">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">{label}</span>
            </div>
            <div className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center px-1.5 text-center">
                <span className="w-full truncate font-mono text-2xs text-warning">{type}</span>
                {children}
            </div>
        </div>
    );
}

/**
 * Renders when a document element type has no registered renderer (hard cutover: no silent
 * pretend-widget). The type is normally a plugin's, and the plugin is uninstalled, switched off or
 * failed to load; `ui/unknown-widget` reports the same element in the project check, and refuses
 * the build rather than shipping a page with a hole in it.
 *
 * Children still render: the element's own subtree is authored content that has nothing wrong with
 * it, and dropping it would hide more of the page than is actually broken.
 */
export function renderUnknownWidgetTypeContent(element: UIElement, children: ReactNode[]): ReactNode {
    if (typeof console !== "undefined" && console.warn) {
        console.warn(`[UI Editor] Unsupported widget type "${element.type}" (element ${element.id})`);
    }

    return (
        <WidgetProblemBlock label={translate("uiEditor.canvas.unknownWidget")} type={element.type}>
            {children.length > 0 ? <div className="w-full flex-1 min-h-0">{children}</div> : null}
        </WidgetProblemBlock>
    );
}

/**
 * Renders where a widget's own render function threw.
 *
 * Only a plugin's render reaches this: the built-in renderers are host code, and a throw in one of
 * them is a Studio defect that should surface as one rather than be dressed up as a widget
 * problem. See `WidgetRenderBoundary`.
 */
export function renderWidgetRenderFailureContent(type: string): ReactNode {
    return <WidgetProblemBlock label={translate("uiEditor.canvas.widgetRenderFailed")} type={type} />;
}
