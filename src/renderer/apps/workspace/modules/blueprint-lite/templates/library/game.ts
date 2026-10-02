/**
 * Game: starting, continuing and steering the story from a widget.
 *
 * Comments in English per project convention.
 */

import { ChevronsRight, CirclePlay, House, MessageSquareOff, Play, StepForward, Undo2 } from "lucide-react";
import type { Locale } from "@shared/i18n/locales";
import type { BlueprintLayerTemplate, BlueprintLayerTemplateFacts } from "../blueprintLayerTemplates";
import { field, lines, WIDGET_OWNERS } from "./templateText";

/** What the return-to-title template writes into the game, so it is what the player reads. */
const TO_TITLE_TEXT: Readonly<Record<Locale, { question: string; confirm: string; cancel: string }>> = {
    en: { question: "Return to the title screen? Unsaved progress is lost.", confirm: "Return to title", cancel: "Cancel" },
    zh: { question: "返回标题画面？未保存的进度将会丢失。", confirm: "返回标题", cancel: "取消" },
    ja: {
        question: "タイトル画面に戻りますか？セーブしていない進行状況は失われます。",
        confirm: "タイトルへ",
        cancel: "キャンセル",
    },
};

/** `Show Confirm` asking whether to leave for the title, with Return as the first button and Cancel as the second. */
function toTitleConfirmNode(id: string, position: string, facts: BlueprintLayerTemplateFacts): string {
    const text = TO_TITLE_TEXT[facts.locale];
    return lines(
        `    ${id}: blueprint.layer.confirm ${position}`,
        field("surfaceId", facts.confirmPage),
        `        __confirmButtonPins = ["button_1_label","button_1_pressed","button_2_label","button_2_pressed"]`,
        field("message", text.question),
        field("button_1_label", text.confirm),
        field("button_2_label", text.cancel),
    );
}

export const GAME_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "startGame",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: Play,
        featured: 13,
        text: {
            en: { title: "Start the game", description: "Starts the story when clicked." },
            zh: { title: "开始游戏", description: "点击时开始故事" },
            ja: { title: "ゲームを始める", description: "クリックでストーリーを始める" },
        },
        graph: facts => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    start: blueprint.game.startStory @260,0",
            field("storyId", facts.gameStart?.storyId),
            field("sceneId", facts.gameStart?.sceneId),
            "    click -> start",
        ),
        choices: { start: ["storyId", "sceneId"] },
    },
    {
        id: "continueGame",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: StepForward,
        text: {
            en: {
                title: "Continue the game",
                description: "Loads the latest auto save when clicked. Without an auto save, the click does nothing.",
            },
            zh: { title: "继续游戏", description: "点击时读取最新的自动存档，没有自动存档时不执行任何操作" },
            ja: { title: "続きから始める", description: "クリックで最新の自動セーブを読み込み、自動セーブがなければ何もしない" },
        },
        // Auto saves only. While auto saving is on, the game writes one every few seconds of play,
        // so the newest is where the player left off; finding the newest manual save would take a
        // loop over every slot and its time.
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    latest: blueprint.game.autoSave.latest @260,0",
            "    found: if @520,0",
            "    load: blueprint.game.save.load @780,0",
            "    click -> latest -> found",
            "    latest.hasAutoSave -> found.condition",
            "    found.true -> load",
            "    latest.id -> load.id",
        ),
    },
    {
        id: "returnToTitle",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: House,
        text: {
            en: {
                title: "Return to title",
                description: "Asks for confirmation when clicked, then ends the current game and returns to the title screen.",
            },
            zh: { title: "返回标题", description: "点击时询问确认，确认后结束当前游戏并返回标题画面" },
            ja: { title: "タイトルに戻る", description: "クリックで確認を求め、承認されると現在のゲームを終了してタイトル画面に戻る" },
        },
        // Quit Game, not Quit Application: it ends the playthrough and opens the page it names,
        // which is the title page here, where Quit Application closes the window.
        graph: facts => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            toTitleConfirmNode("ask", "@260,0", facts),
            "    quit: blueprint.game.quit @580,0",
            "    click -> ask",
            "    ask.button_1_pressed -> quit",
        ),
        choices: { ask: ["surfaceId"], quit: ["surfaceId"] },
    },
    {
        id: "autoForwardButton",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: CirclePlay,
        text: {
            en: { title: "Auto forward button", description: "Turns auto forward on or off when clicked." },
            zh: { title: "自动前进按钮", description: "点击时开启或关闭自动前进" },
            ja: { title: "自動送りボタン", description: "クリックで自動送りのオンとオフを切り替える" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    current: blueprint.game.getAutoForward @0,160",
            "    flip: blueprint.boolean.not @260,160",
            "    set: blueprint.game.setAutoForward @260,0",
            "    click -> set",
            "    current.autoForward -> flip.a",
            "    flip.result -> set.autoForward",
        ),
    },
    {
        id: "skipButton",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: ChevronsRight,
        text: {
            en: { title: "Skip button", description: "Turns skipping on or off when clicked." },
            zh: { title: "跳过按钮", description: "点击时开启或关闭持续跳过" },
            ja: { title: "スキップボタン", description: "クリックで連続スキップのオンとオフを切り替える" },
        },
        // Read back rather than remembered: skipping turns itself off when it stops on its own - at
        // a line not yet read, or when a page opens over the story - so the next click starts it.
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    current: blueprint.game.getSkipping @0,160",
            "    flip: blueprint.boolean.not @260,160",
            "    set: blueprint.game.setSkipping @260,0",
            "    click -> set",
            "    current.skipping -> flip.a",
            "    flip.result -> set.skipping",
        ),
    },
    {
        id: "hideDialogButton",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: MessageSquareOff,
        text: {
            en: { title: "Hide dialog button", description: "Hides or shows the dialog box when clicked." },
            zh: { title: "隐藏对话框按钮", description: "点击时隐藏或显示对话框" },
            ja: { title: "ダイアログ非表示ボタン", description: "クリックでダイアログの表示と非表示を切り替える" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    toggle: blueprint.game.toggleDialogDisplay @260,0",
            "    click -> toggle",
        ),
    },
    {
        id: "backOneLine",
        category: "game",
        owners: WIDGET_OWNERS,
        icon: Undo2,
        text: {
            en: { title: "Back one line", description: "Returns the story to the previous line when clicked." },
            zh: { title: "回到上一行", description: "点击时让故事回到上一行" },
            ja: { title: "一つ前の行に戻る", description: "クリックでストーリーを一つ前の行に戻す" },
        },
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    undo: blueprint.game.history.undoLast @260,0",
            "    click -> undo",
        ),
    },
];
