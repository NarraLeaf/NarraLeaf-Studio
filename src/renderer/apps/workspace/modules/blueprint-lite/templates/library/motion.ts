/**
 * Motion: a widget that keeps moving for as long as it is shown.
 *
 * How a widget arrives and leaves is not here, nor how it answers the pointer: those are the
 * element's Animation section and its appearance's hovered and pressed states in the inspector, and a
 * layer doing either as well would be a second way to say the same thing.
 *
 * Comments in English per project convention.
 */

import { Activity, MoveVertical } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, WIDGET_OWNERS } from "./templateText";

export const MOTION_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "pulse",
        category: "motion",
        owners: WIDGET_OWNERS,
        icon: Activity,
        text: {
            en: { title: "Pulse", description: "Slowly dims and returns to full opacity, repeating for as long as it is shown." },
            zh: { title: "呼吸效果", description: "显示期间反复缓慢变淡再恢复" },
            ja: { title: "ゆっくり明滅", description: "表示中はゆっくり薄くなっては元に戻るのを繰り返す" },
        },
        // The way back names 100 rather than leaving `to` empty: an empty `to` means the opacity the
        // widget has now, which after the first pass is the dimmed one. Nothing in the graph ends the
        // loop because nothing has to - closing the page cancels every run its blueprints have
        // pending, this one included.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    dim: blueprint.displayable.animateProperty @260,0",
            "        property = opacity",
            "        to = 30",
            "        duration = 1",
            "        easing = easeInOut",
            "    brighten: blueprint.displayable.animateProperty @520,0",
            "        property = opacity",
            "        to = 100",
            "        duration = 1",
            "        easing = easeInOut",
            "    init -> dim -> brighten",
            "    brighten -> dim",
        ),
    },
    {
        id: "float",
        category: "motion",
        owners: WIDGET_OWNERS,
        icon: MoveVertical,
        text: {
            en: { title: "Float", description: "Drifts slowly up and down, repeating for as long as it is shown." },
            zh: { title: "上下浮动", description: "显示期间反复缓慢地上下浮动" },
            ja: { title: "上下に浮遊", description: "表示中はゆっくり上下に揺れ続ける" },
        },
        // An offset rather than Y, so the widget moves about where it was placed instead of to a
        // position written into the graph. Like the pulse, the loop ends with the page.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    up: blueprint.displayable.animateProperty @260,0",
            "        property = offsetY",
            "        to = -8",
            "        duration = 1.2",
            "        easing = easeInOut",
            "    down: blueprint.displayable.animateProperty @520,0",
            "        property = offsetY",
            "        to = 0",
            "        duration = 1.2",
            "        easing = easeInOut",
            "    init -> up -> down",
            "    down -> up",
        ),
    },
];
