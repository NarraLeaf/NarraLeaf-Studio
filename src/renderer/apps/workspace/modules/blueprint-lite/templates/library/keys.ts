/**
 * Keys: keyboard shortcuts, on one page or for the whole game.
 *
 * A key is written the way the key picker stores it (`formatBlueprintKeyboardBinding`), so a
 * template's binding shows in the inspector exactly as one the author picked would.
 *
 * Comments in English per project convention.
 */

import { ArrowLeft, Camera, EyeOff, Maximize, PanelsTopLeft, TimerReset } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines } from "./templateText";

export const KEY_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "escapeBack",
        category: "keys",
        owners: ["surfaceMain"],
        icon: ArrowLeft,
        featured: 4,
        text: {
            en: { title: "Back on Escape", description: "Escape closes this page and returns to the page beneath it." },
            zh: { title: "Esc 返回", description: "按 Esc 关闭当前页面，回到下层页面" },
            ja: { title: "Esc で戻る", description: "Esc で現在のページを閉じ、下のページに戻る" },
        },
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=Escape @0,0",
            "    back: blueprint.page.back @260,0",
            "    key -> back",
        ),
    },
    {
        id: "escapeMenu",
        category: "keys",
        owners: ["surfaceMain"],
        icon: PanelsTopLeft,
        text: {
            en: { title: "Menu on Escape", description: "Escape opens a page on top of this one." },
            zh: { title: "Esc 打开菜单", description: "按 Esc 在当前页面上叠加一个页面" },
            ja: { title: "Esc でメニュー", description: "Esc で現在のページの上に別のページを重ねて表示する" },
        },
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=Escape @0,0",
            "    menu: blueprint.layer.show @260,0",
            "        modal = true",
            "        dismissible = true",
            "    key -> menu",
        ),
        choices: { menu: ["surfaceId"] },
    },
    {
        id: "fullscreenKey",
        category: "keys",
        owners: ["globalMain"],
        icon: Maximize,
        featured: 2,
        text: {
            en: { title: "Fullscreen key", description: "F11 turns fullscreen on and off." },
            zh: { title: "全屏快捷键", description: "按 F11 进入或退出全屏" },
            ja: { title: "全画面キー", description: "F11 で全画面を切り替える" },
        },
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=f11 @0,0",
            "    toggle: blueprint.app.setFullscreen mode=toggle @260,0",
            "    key -> toggle",
        ),
    },
    {
        id: "screenshotKey",
        category: "keys",
        owners: ["globalMain"],
        icon: Camera,
        featured: 3,
        text: {
            en: { title: "Screenshot key", description: "S saves a screenshot." },
            zh: { title: "截图快捷键", description: "按 S 保存截图" },
            ja: { title: "スクリーンショットキー", description: "S でスクリーンショットを保存する" },
        },
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=S @0,0",
            "    shot: blueprint.app.saveScreenshot @260,0",
            "    key -> shot",
        ),
    },
    {
        id: "autoForwardKey",
        category: "keys",
        owners: ["globalMain"],
        icon: TimerReset,
        text: {
            en: { title: "Auto forward key", description: "A turns auto forward on and off while a story plays." },
            zh: { title: "自动前进快捷键", description: "游戏进行中按 A 开启或关闭自动前进" },
            ja: { title: "自動送りキー", description: "ゲーム中に A で自動送りを切り替える" },
        },
        // The game's own blueprint hears keys on every page, the title screen included, where a
        // preference set now would be waiting in the next game the player starts: Is In Game keeps
        // the key to a running one.
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=A @0,0",
            "    playing: blueprint.game.isInGame @0,160",
            "    gate: if @260,0",
            "    current: blueprint.game.getAutoForward @260,160",
            "    flip: blueprint.boolean.not @520,160",
            "    set: blueprint.game.setAutoForward @520,0",
            "    key -> gate",
            "    playing.isInGame -> gate.condition",
            "    gate.true -> set",
            "    current.autoForward -> flip.a",
            "    flip.result -> set.autoForward",
        ),
    },
    {
        id: "hideDialogKey",
        category: "keys",
        owners: ["globalMain"],
        icon: EyeOff,
        text: {
            en: { title: "Hide dialog key", description: "H hides and shows the dialog box while a story plays." },
            zh: { title: "隐藏对话框快捷键", description: "游戏进行中按 H 隐藏或显示对话框" },
            ja: { title: "ダイアログ非表示キー", description: "ゲーム中に H でダイアログの表示を切り替える" },
        },
        // Kept to a running game, for the reason the auto forward key gives.
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=H @0,0",
            "    playing: blueprint.game.isInGame @0,160",
            "    gate: if @260,0",
            "    toggle: blueprint.game.toggleDialogDisplay @520,0",
            "    key -> gate",
            "    playing.isInGame -> gate.condition",
            "    gate.true -> toggle",
        ),
    },
];
