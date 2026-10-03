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

/**
 * The graph's first column for a key that acts on the story: the head, then an If that lets the
 * press through only while the story is what the player is looking at.
 *
 * The game's own blueprint hears keys on every page. Is In Game keeps a key off the title screen,
 * where a preference set now would be waiting in the next game the player starts. Is Game Overlay -
 * asked of the page the player is looking at, which is whose host the game's blueprint runs on -
 * keeps it off a menu opened over the story: H pressed in the settings would otherwise hide the
 * dialogue box behind them, and the player would come back to a story with no box until they clicked.
 */
function storyOnScreenGate(key: string): string {
    return lines(
        `    key: blueprint.event.head.keyDown key=${key} @0,0`,
        "    playing: blueprint.game.isInGame @0,160",
        "    overlay: blueprint.game.isGameOverlay @0,300",
        "    uncovered: blueprint.boolean.not @260,300",
        "    onScreen: blueprint.boolean.and @260,160",
        "    gate: if @520,0",
        "    key -> gate",
        "    playing.isInGame -> onScreen.a",
        "    overlay.isGameOverlay -> uncovered.a",
        "    uncovered.result -> onScreen.b",
        "    onScreen.result -> gate.condition",
    );
}

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
            en: { title: "Auto forward key", description: "A turns auto forward on and off while the story is on screen." },
            zh: { title: "自动前进快捷键", description: "剧情画面中按 A 开启或关闭自动前进" },
            ja: { title: "自動送りキー", description: "ストーリー画面で A を押すと自動送りを切り替える" },
        },
        graph: () => lines(
            storyOnScreenGate("A"),
            "    current: blueprint.game.getAutoForward @780,160",
            "    flip: blueprint.boolean.not @1040,160",
            "    set: blueprint.game.setAutoForward @1040,0",
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
            en: { title: "Hide dialog key", description: "H hides and shows the dialog box while the story is on screen." },
            zh: { title: "隐藏对话框快捷键", description: "剧情画面中按 H 隐藏或显示对话框" },
            ja: { title: "ダイアログ非表示キー", description: "ストーリー画面で H を押すとダイアログの表示を切り替える" },
        },
        graph: () => lines(
            storyOnScreenGate("H"),
            "    toggle: blueprint.game.toggleDialogDisplay @780,0",
            "    gate.true -> toggle",
        ),
    },
];
