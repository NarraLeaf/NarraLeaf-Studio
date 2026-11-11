import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { SliderRenderer } from "./slider/renderer";
import { createSliderInspector } from "./slider/inspector";
import { defineWidgetModule } from "../declaration";
import { SliderWidgetDeclaration } from "./slider.declaration";

export const SliderWidgetModule: UIWidgetModule = defineWidgetModule(SliderWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <SliderRenderer {...props}/>,
    createInspector: createSliderInspector
});
