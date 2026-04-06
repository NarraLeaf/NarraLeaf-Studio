import type { UIElement } from "@shared/types/ui-editor/document";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleRenderer } from "../rectangle/renderer";
import { getImageWidgetRectangleProps } from "./helpers";

export function ImageRenderer(props: WidgetRendererProps) {
    const rectProps = getImageWidgetRectangleProps(props.element);
    return (
        <RectangleRenderer
            {...props}
            element={{
                ...props.element,
                props: { ...props.element.props, ...rectProps } as UIElement["props"],
            }}
        />
    );
}
