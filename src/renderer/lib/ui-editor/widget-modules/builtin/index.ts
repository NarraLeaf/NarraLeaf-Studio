import type { UIWidgetModule } from "../types";
import { RectangleWidgetModule } from "./rectangle";
import { TextWidgetModule } from "./text";
import { ImageWidgetModule } from "./image";
import { ContainerWidgetModule } from "./container";
import { ButtonWidgetModule } from "./button";
import { StackWidgetModule } from "./stack";
import { ScrollWidgetModule } from "./scroll";
import { SpacerDividerWidgetModule } from "./spacerDivider";
import { ListRepeaterWidgetModule } from "./listRepeater";

/**
 * All built-in widget modules.
 * Add new modules here to make them available in the editor.
 */
export const BuiltinWidgetModules: UIWidgetModule[] = [
    RectangleWidgetModule,
    TextWidgetModule,
    ImageWidgetModule,
    ContainerWidgetModule,
    ButtonWidgetModule,
    StackWidgetModule,
    ScrollWidgetModule,
    SpacerDividerWidgetModule,
    ListRepeaterWidgetModule,
];
