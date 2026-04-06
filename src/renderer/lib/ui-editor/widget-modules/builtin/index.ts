import type { UIWidgetModule } from "../types";
import { TextWidgetModule } from "./text";
import { ImageWidgetModule } from "./image";
import { ContainerWidgetModule } from "./container";
import { ButtonWidgetModule } from "./button";
import { ListWidgetModule } from "./list";

/**
 * All built-in widget modules (user-insertable palette).
 */
export const BuiltinWidgetModules: UIWidgetModule[] = [
    ContainerWidgetModule,
    TextWidgetModule,
    ImageWidgetModule,
    ButtonWidgetModule,
    ListWidgetModule,
];
