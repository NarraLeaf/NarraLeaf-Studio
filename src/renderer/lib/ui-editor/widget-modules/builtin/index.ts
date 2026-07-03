import type { UIWidgetModule } from "../types";
import { RootWidgetModule } from "./root";
import { TextWidgetModule } from "./text";
import { ImageWidgetModule } from "./image";
import { ContainerWidgetModule } from "./container";
import { ButtonWidgetModule } from "./button";
import { ListWidgetModule } from "./list";
import { FrameWidgetModule } from "./frame";
import { SliderWidgetModule } from "./slider";
import { DialogSentenceWidgetModule } from "./dialog";

/**
 * All built-in widget modules registered at startup (includes internal `nl.root`).
 * User insert palette order is `listInsertPaletteModules()` in `insertPalette.ts`.
 */
export const BuiltinWidgetModules: UIWidgetModule[] = [
    RootWidgetModule,
    ContainerWidgetModule,
    TextWidgetModule,
    ImageWidgetModule,
    ButtonWidgetModule,
    SliderWidgetModule,
    ListWidgetModule,
    FrameWidgetModule,
    DialogSentenceWidgetModule,
];

/** Runs optional `registerBlueprintNodes` on each built-in module (idempotent per module). */
export function registerBuiltinWidgetBlueprintNodes(): void {
    for (const m of BuiltinWidgetModules) {
        m.registerBlueprintNodes?.();
    }
}
