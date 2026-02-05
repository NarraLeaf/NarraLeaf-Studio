import type { UIWidgetModule } from "../types";
import { RectangleWidgetModule } from "./rectangle";

/**
 * All built-in widget modules.
 * Add new modules here to make them available in the editor.
 */
export const BuiltinWidgetModules: UIWidgetModule[] = [
    RectangleWidgetModule,
];
