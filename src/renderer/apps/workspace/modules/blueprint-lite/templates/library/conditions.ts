/**
 * Conditions: a widget that is there, or usable, only when something about the game holds - a game
 * is being played, there is a save to continue from, the player has reached an ending.
 *
 * There is no template for a scene the player has seen. Is Scene Visited reads the record kept in the
 * save, which rewinds with a load and does not exist outside a game, so on the title screen - where a
 * scene replay is opened from - every scene reads as unseen.
 *
 * Each one asks once, as the widget starts, and writes both answers - shown or hidden, enabled or
 * disabled - rather than only the one that differs from the inspector. So it does not matter how the
 * widget was left in the inspector, and a page drawn again after the answer changed - back on the
 * title screen after reaching an ending - asks again and shows the new one.
 *
 * Comments in English per project convention.
 */

import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { field, lines, WIDGET_OWNERS } from "./templateText";

export const CONDITION_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "showInGameOnly",
        category: "conditions",
        owners: WIDGET_OWNERS,
        text: {
            en: {
                title: "Only during a game",
                description: "Shows the widget only while a game is being played, and hides it on a page opened from the title screen.",
            },
            zh: { title: "仅在游戏中显示", description: "只在游戏进行中显示，在从标题画面打开的页面上隐藏" },
            ja: { title: "ゲーム中のみ表示", description: "ゲームのプレイ中だけ表示し、タイトル画面から開いたページでは隠す" },
        },
        // For a page reached both ways - the settings, the log - where Save, or Return to title, has
        // nothing to act on outside a game.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    playing: blueprint.game.isInGame @0,160",
            "    show: blueprint.displayable.setDisplay @260,0",
            "    init -> show",
            "    playing.isInGame -> show.display",
        ),
    },
    {
        id: "disableWithoutAutoSave",
        category: "conditions",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Disabled without an auto save", description: "Greys the button out while there is no auto save to continue from." },
            zh: { title: "没有自动存档时禁用", description: "没有可继续的自动存档时，按钮变灰且不可点击" },
            ja: { title: "自動セーブがなければ無効", description: "続きから始められる自動セーブがないとき、ボタンを無効にする" },
        },
        // The other half of the continue template, which loads the latest auto save: the same
        // question, asked before the player can click rather than after.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    latest: blueprint.game.autoSave.latest @260,0",
            "    enable: blueprint.button.setEnabled @520,0",
            "    init -> latest -> enable",
            "    latest.hasAutoSave -> enable.enabled",
        ),
    },
    {
        id: "showAfterAnyEnding",
        category: "conditions",
        owners: WIDGET_OWNERS,
        text: {
            en: {
                title: "After any ending",
                description: "Shows the widget only once the player has reached an ending, as an extras menu often is.",
            },
            zh: { title: "达成任一结局后显示", description: "玩家达成至少一个结局后才显示，常用于通关后开放的鉴赏等内容" },
            ja: { title: "エンディング到達後に表示", description: "プレイヤーがいずれかのエンディングに到達してから表示する。クリア後に開くおまけなどに使える" },
        },
        // Reached endings are kept across playthroughs, so once shown it stays shown in every game
        // after. The story is the default one.
        graph: facts => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.displayable.setDisplay @1040,0",
            "    endings: blueprint.game.getEndings @0,160",
            field("storyId", facts.gameStart?.storyId),
            "    reachedOnly: blueprint.collection.arrayFilter @260,160",
            "        key = isReached",
            "    yes: blueprint.data.booleanLiteral @0,320",
            "        value = true",
            "    none: blueprint.collection.arrayIsEmpty @520,160",
            "    some: blueprint.boolean.not @780,160",
            "    init -> show",
            "    endings.endings -> reachedOnly.array",
            "    yes.value -> reachedOnly.value",
            "    reachedOnly.result -> none.array",
            "    none.result -> some.a",
            "    some.result -> show.display",
        ),
        choices: { endings: ["storyId"] },
    },
    {
        id: "showAfterEnding",
        category: "conditions",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "After an ending", description: "Shows the widget only once the player has reached the ending you choose." },
            zh: { title: "达成指定结局后显示", description: "玩家达成指定的结局后才显示" },
            ja: { title: "特定のエンディング後に表示", description: "プレイヤーが指定したエンディングに到達してから表示する" },
        },
        graph: facts => lines(
            "    init: blueprint.event.head.init @0,0",
            "    reached: blueprint.game.isEndingReached @0,160",
            field("storyId", facts.gameStart?.storyId),
            "    show: blueprint.displayable.setDisplay @260,0",
            "    init -> show",
            "    reached.isReached -> show.display",
        ),
        choices: { reached: ["storyId", "endingId"] },
    },
];
