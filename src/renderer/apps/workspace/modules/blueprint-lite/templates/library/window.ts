/**
 * Window: closing the game, and what the game window itself does.
 *
 * Comments in English per project convention.
 */

import { Aperture, Expand, FolderOpen, MessageSquareWarning, Power } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, quitConfirmNode, WIDGET_OWNERS } from "./templateText";

export const WINDOW_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "confirmClose",
        category: "window",
        owners: ["globalMain"],
        icon: MessageSquareWarning,
        featured: 1,
        text: {
            en: { title: "Confirm before closing", description: "Asks the player before the game window closes." },
            zh: { title: "关闭前确认", description: "关闭游戏窗口前询问玩家" },
            ja: { title: "閉じる前の確認", description: "ゲームウィンドウを閉じる前にプレイヤーに確認する" },
        },
        // The close request waits for this graph, so the window is kept first and the question
        // asked after; Quit Application is what closes it once the player agrees. Offered only
        // where the project already has a page it asks through: with the page left to choose, the
        // window would be kept open and the question never asked, and the close button would do
        // nothing at all.
        available: facts => facts.confirmPage !== undefined,
        graph: facts => lines(
            "    close: blueprint.event.head.windowCloseRequested @0,0",
            "    keep: blueprint.app.keepWindowOpen @260,0",
            quitConfirmNode("ask", "@520,0", facts),
            "    quit: blueprint.page.quit @840,0",
            "    close -> keep -> ask",
            "    ask.button_1_pressed -> quit",
        ),
        choices: { ask: ["surfaceId"] },
    },
    {
        id: "quitApp",
        category: "window",
        owners: WIDGET_OWNERS,
        icon: Power,
        featured: 14,
        text: {
            en: { title: "Quit button", description: "Asks for confirmation when clicked, then quits the game." },
            zh: { title: "退出按钮", description: "点击时询问确认，确认后退出游戏" },
            ja: { title: "終了ボタン", description: "クリックで確認を求め、承認されるとゲームを終了する" },
        },
        graph: facts => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            quitConfirmNode("ask", "@260,0", facts),
            "    quit: blueprint.page.quit @580,0",
            "    click -> ask",
            "    ask.button_1_pressed -> quit",
        ),
        choices: { ask: ["surfaceId"] },
    },
    {
        id: "fullscreenButton",
        category: "window",
        owners: WIDGET_OWNERS,
        icon: Expand,
        text: {
            en: { title: "Fullscreen button", description: "Turns fullscreen on and off when clicked." },
            zh: { title: "全屏按钮", description: "点击时进入或退出全屏" },
            ja: { title: "全画面ボタン", description: "クリックで全画面を切り替える" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    toggle: blueprint.app.setFullscreen mode=toggle @260,0",
            "    click -> toggle",
        ),
    },
    {
        id: "screenshotButton",
        category: "window",
        owners: WIDGET_OWNERS,
        icon: Aperture,
        text: {
            en: { title: "Screenshot button", description: "Saves a screenshot when clicked." },
            zh: { title: "截图按钮", description: "点击时保存截图" },
            ja: { title: "スクリーンショットボタン", description: "クリックでスクリーンショットを保存する" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    shot: blueprint.app.saveScreenshot @260,0",
            "    click -> shot",
        ),
    },
    {
        id: "screenshotsFolder",
        category: "window",
        owners: WIDGET_OWNERS,
        icon: FolderOpen,
        text: {
            en: { title: "Open the screenshots folder", description: "Opens the folder screenshots are saved to when clicked." },
            zh: { title: "打开截图文件夹", description: "点击时打开截图文件夹" },
            ja: { title: "スクリーンショットのフォルダーを開く", description: "クリックでスクリーンショットのフォルダーを開く" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    open: blueprint.app.openScreenshotsFolder @260,0",
            "    click -> open",
        ),
    },
];
