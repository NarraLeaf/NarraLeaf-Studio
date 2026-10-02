/**
 * Navigation: a widget that takes the player to another page, or back from this one.
 *
 * Comments in English per project convention.
 */

import { ArrowLeft, ArrowRight, CornerUpLeft, ExternalLink, Layers, SquareX } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, WIDGET_OWNERS } from "./templateText";

export const NAVIGATION_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "openPage",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: ArrowRight,
        featured: 11,
        text: {
            en: { title: "Open a page", description: "Opens a page when clicked." },
            zh: { title: "打开页面", description: "点击时前往指定页面" },
            ja: { title: "ページを開く", description: "クリックで指定したページへ移動する" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    open: blueprint.page.go @260,0",
            "    click -> open",
        ),
        choices: { open: ["surfaceId"] },
    },
    {
        id: "goBack",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: ArrowLeft,
        featured: 12,
        text: {
            en: { title: "Go back", description: "Closes the current page when clicked and returns to the page beneath it." },
            zh: { title: "返回", description: "点击时关闭当前页面，回到下层页面" },
            ja: { title: "戻る", description: "クリックで現在のページを閉じ、下のページに戻る" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    back: blueprint.page.back @260,0",
            "    click -> back",
        ),
    },
    {
        id: "overlayPage",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: Layers,
        text: {
            en: { title: "Page on top", description: "Opens a page on top of the current one when clicked." },
            zh: { title: "叠加页面", description: "点击时在当前页面上叠加一个页面" },
            ja: { title: "ページを重ねる", description: "クリックで現在のページの上に別のページを重ねて表示する" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    show: blueprint.layer.show @260,0",
            "        modal = true",
            "        dismissible = true",
            "    click -> show",
        ),
        choices: { show: ["surfaceId"] },
    },
    {
        id: "closeLayer",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: SquareX,
        text: {
            en: {
                title: "Close the page on top",
                description: "Closes this page when clicked, if it was opened on top of another page.",
            },
            zh: { title: "关闭叠加页面", description: "点击时关闭叠加在其他页面上的当前页面" },
            ja: { title: "重ねたページを閉じる", description: "クリックで、別のページの上に重ねて表示された現在のページを閉じる" },
        },
        // Close This Layer rather than Go back: Go back closes the top layer only when it was shown
        // as dismissible, and otherwise steps back the page underneath it.
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    close: blueprint.layer.closeSelf @260,0",
            "    click -> close",
        ),
    },
    {
        id: "backToGame",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: CornerUpLeft,
        text: {
            en: {
                title: "Back to the game",
                description: "Closes every page opened over the story when clicked. Outside a game, returns to the page beneath.",
            },
            zh: { title: "返回游戏", description: "点击时关闭在故事上方打开的所有页面，不在游戏中时回到下层页面" },
            ja: { title: "ゲームに戻る", description: "クリックでストーリーの上に開いたページをすべて閉じ、ゲーム外では下のページに戻る" },
        },
        // For a page reached both from the title screen and from inside a game. Clear Page closes
        // every page a running game has open over it, however many deep, and does nothing outside
        // one, where Go back then steps back one page.
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    clear: blueprint.page.clear @260,0",
            "    back: blueprint.page.back @520,0",
            "    click -> clear -> back",
        ),
    },
    {
        id: "openLink",
        category: "navigation",
        owners: WIDGET_OWNERS,
        icon: ExternalLink,
        text: {
            en: { title: "Open a link", description: "Opens a web page in the browser when clicked." },
            zh: { title: "打开链接", description: "点击时在浏览器中打开网页" },
            ja: { title: "リンクを開く", description: "クリックでウェブページをブラウザで開く" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    open: blueprint.app.openExternal @260,0",
            "    click -> open",
        ),
        choices: { open: ["url"] },
    },
];
