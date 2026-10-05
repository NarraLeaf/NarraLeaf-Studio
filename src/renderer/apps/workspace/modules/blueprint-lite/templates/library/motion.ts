/**
 * Motion: a widget that keeps moving for as long as it is shown, or moves once when clicked.
 *
 * How a widget arrives and leaves is not here, nor how it looks under the pointer: those are the
 * element's Animation section and its appearance's hovered and pressed states in the inspector, and a
 * layer doing either as well would be a second way to say the same thing. A shake on a click is here
 * because it is a movement, which a state - a look held while the pointer is down - cannot be.
 *
 * Comments in English per project convention.
 */

import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, WIDGET_OWNERS } from "./templateText";

export const MOTION_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "pulse",
        category: "motion",
        owners: WIDGET_OWNERS,
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
    {
        id: "sway",
        category: "motion",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Sway", description: "Tilts slowly from side to side, repeating for as long as it is shown." },
            zh: { title: "左右摇摆", description: "显示期间反复缓慢地左右摇摆" },
            ja: { title: "左右に揺れる", description: "表示中はゆっくり左右に傾き続ける" },
        },
        // A few degrees either way around where the widget was placed, for a hanging sign or a leaf.
        // The first pass starts from upright, so the widget eases into the swing rather than jumping.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    right: blueprint.displayable.animateProperty @260,0",
            "        property = rotation",
            "        to = 3",
            "        duration = 1.5",
            "        easing = easeInOut",
            "    left: blueprint.displayable.animateProperty @520,0",
            "        property = rotation",
            "        to = -3",
            "        duration = 1.5",
            "        easing = easeInOut",
            "    init -> right -> left",
            "    left -> right",
        ),
    },
    {
        id: "spin",
        category: "motion",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Spin", description: "Turns round at a steady speed for as long as it is shown." },
            zh: { title: "旋转", description: "显示期间匀速不停地旋转" },
            ja: { title: "回転", description: "表示中は一定の速さで回り続ける" },
        },
        // Two half turns handing back to each other, the shape of the other loops here. The second
        // ends on 360, which is the angle the first starts from, so the seam does not show.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    firstHalf: blueprint.displayable.animateProperty @260,0",
            "        property = rotation",
            "        from = 0",
            "        to = 180",
            "        duration = 1",
            "        easing = linear",
            "    secondHalf: blueprint.displayable.animateProperty @520,0",
            "        property = rotation",
            "        from = 180",
            "        to = 360",
            "        duration = 1",
            "        easing = linear",
            "    init -> firstHalf -> secondHalf",
            "    secondHalf -> firstHalf",
        ),
    },
    {
        id: "slowZoom",
        category: "motion",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Slow zoom", description: "Grows a little and shrinks back very slowly, repeating for as long as it is shown." },
            zh: { title: "缓慢缩放", description: "显示期间反复极其缓慢地略微放大再缩回" },
            ja: { title: "ゆっくり拡大縮小", description: "表示中はごくゆっくり少し拡大しては元に戻るのを繰り返す" },
        },
        // For a title screen's background picture, which reads as still at a glance but alive. Scale
        // is a factor and grows the widget about its middle, so 1.08 is eight per cent larger.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    grow: blueprint.displayable.animateProperty @260,0",
            "        property = scale",
            "        from = 1",
            "        to = 1.08",
            "        duration = 12",
            "        easing = easeInOut",
            "    shrink: blueprint.displayable.animateProperty @520,0",
            "        property = scale",
            "        from = 1.08",
            "        to = 1",
            "        duration = 12",
            "        easing = easeInOut",
            "    init -> grow -> shrink",
            "    shrink -> grow",
        ),
    },
    {
        id: "shakeOnClick",
        category: "motion",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Shake when clicked", description: "Shakes briefly from side to side when clicked, as something locked does." },
            zh: { title: "点击时抖动", description: "点击时短暂地左右抖动，适合表示尚未解锁" },
            ja: { title: "クリックで揺れる", description: "クリックすると短く左右に揺れ、まだ使えないことを示す" },
        },
        // An offset, so the shake is about where the widget stands, and each step names where it goes
        // so a second click during a shake finishes back at rest.
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    left: blueprint.displayable.animateProperty @260,0",
            "        property = offsetX",
            "        to = -8",
            "        duration = 0.06",
            "        easing = easeOut",
            "    right: blueprint.displayable.animateProperty @520,0",
            "        property = offsetX",
            "        to = 8",
            "        duration = 0.1",
            "        easing = easeInOut",
            "    back: blueprint.displayable.animateProperty @780,0",
            "        property = offsetX",
            "        to = -4",
            "        duration = 0.08",
            "        easing = easeInOut",
            "    rest: blueprint.displayable.animateProperty @1040,0",
            "        property = offsetX",
            "        to = 0",
            "        duration = 0.06",
            "        easing = easeIn",
            "    click -> left -> right -> back -> rest",
        ),
    },
];
