/**
 * Page flow: what a whole page does on its own - a splash that moves on, a page that waits for a key.
 *
 * Comments in English per project convention.
 */

import { Clapperboard, ClockFading, Keyboard } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { field, lines } from "./templateText";

export const PAGE_FLOW_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "splash",
        category: "pageFlow",
        owners: ["surfaceMain"],
        icon: Clapperboard,
        featured: 1,
        text: {
            en: {
                title: "Splash screen",
                description: "Fades in, holds, fades out and opens the next page. A click or any key cuts the hold short.",
            },
            zh: { title: "开屏动画", description: "淡入、停留、淡出后前往下一个页面，点击或按任意键可结束停留" },
            ja: {
                title: "スプラッシュ画面",
                description: "フェードイン・表示・フェードアウトの後に次のページへ移動し、クリックか任意のキーで表示を切り上げる",
            },
        },
        // Faded from Surface Init, which runs before the page is first painted, so the content is
        // already transparent when it appears rather than drawn once and then hidden.
        //
        // A click or a key ends the hold rather than opening the next page itself, so Go Page has one
        // way in. With two, a press during the fade-out would start the page leaving, and the
        // fade-out finishing while it left would open the next page a second time.
        graph: facts => lines(
            "    init: blueprint.event.head.surfaceInit @0,0",
            "    content: blueprint.element.ref @0,160",
            field("surfaceId", facts.pageContent?.surfaceId),
            field("elementId", facts.pageContent?.elementId),
            "    fadeIn: blueprint.element.displayable.animateProperty @260,0",
            "        property = opacity",
            "        from = 0",
            "        to = 100",
            "        duration = 1",
            "        easing = easeOut",
            "    hold: blueprint.flow.delay @580,0",
            "        duration = 2",
            "    fadeOut: blueprint.element.displayable.animateProperty @840,0",
            "        property = opacity",
            "        from = 100",
            "        to = 0",
            "        duration = 1",
            "        easing = easeIn",
            "    next: blueprint.page.go @840,400",
            "    click: blueprint.event.head.mouseClick @260,400",
            "    key: blueprint.event.head.anyKeyDown @260,540",
            "    skip: blueprint.flow.skipDelay @580,470",
            "    init -> fadeIn -> hold -> fadeOut -> next",
            "    content.element -> fadeIn.element",
            "    content.element -> fadeOut.element",
            "    click -> skip",
            "    key -> skip",
            "    hold.token -> skip.timer",
        ),
        choices: { content: ["elementId"], next: ["surfaceId"] },
    },
    {
        id: "pressAnyKey",
        category: "pageFlow",
        owners: ["surfaceMain"],
        icon: Keyboard,
        featured: 2,
        text: {
            en: { title: "Press any key", description: "Opens the next page on a click or any key." },
            zh: { title: "按任意键继续", description: "点击或按任意键时前往下一个页面" },
            ja: { title: "任意のキーで続行", description: "クリックか任意のキーで次のページへ移動する" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    key: blueprint.event.head.anyKeyDown @0,160",
            "    next: blueprint.page.go @260,80",
            "    click -> next",
            "    key -> next",
        ),
        choices: { next: ["surfaceId"] },
    },
    {
        id: "timedPage",
        category: "pageFlow",
        owners: ["surfaceMain"],
        icon: ClockFading,
        text: {
            en: {
                title: "Timed page",
                description: "Opens the next page after a few seconds. A click or any key moves on at once.",
            },
            zh: { title: "定时跳转", description: "数秒后前往下一个页面，点击或按任意键可立即前往" },
            ja: { title: "時間経過で次へ", description: "数秒後に次のページへ移動し、クリックか任意のキーですぐに移動する" },
        },
        // A click or a key skips the Delay rather than opening the page itself, so Go Page has one way
        // in whichever comes first. With two, time running out while the page was already leaving
        // because of a press would open the next page a second time. The Delay starts from Surface
        // Init, before the page is shown, so there is no moment a press finds nothing to skip.
        graph: () => lines(
            "    init: blueprint.event.head.surfaceInit @0,0",
            "    wait: blueprint.flow.delay @260,0",
            "        duration = 5",
            "    next: blueprint.page.go @520,0",
            "    click: blueprint.event.head.mouseClick @0,220",
            "    key: blueprint.event.head.anyKeyDown @0,360",
            "    skip: blueprint.flow.skipDelay @260,290",
            "    init -> wait -> next",
            "    click -> skip",
            "    key -> skip",
            "    wait.token -> skip.timer",
        ),
        choices: { next: ["surfaceId"] },
    },
];
