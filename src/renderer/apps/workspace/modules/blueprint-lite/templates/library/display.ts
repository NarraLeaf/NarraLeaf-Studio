/**
 * Display: a text or a picture that shows something the game knows - play time, the time and date,
 * who is speaking, how many endings the player has reached.
 *
 * Each one writes into the widget itself from its own blueprint rather than through a value binding,
 * as the starter's dialogue box does: a value binding is re-run when a variable it read changes, and
 * none of these is a variable.
 *
 * Comments in English per project convention.
 */

import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { field, lines, WIDGET_OWNERS } from "./templateText";

/**
 * A text that writes `value` into itself when it starts and again every second after.
 *
 * Nothing raises an event when play time or the clock moves on, so the layer keeps time itself: the
 * Delay hands back to Set Text, which reads its pure inputs afresh on every pass. The loop is part
 * of the page's run, which is cancelled when the page closes, so it stops with the page.
 */
function everySecondGraph(value: string, ...source: string[]): string {
    return lines(
        "    init: blueprint.event.head.init @0,0",
        "    show: blueprint.text.setText @260,0",
        "    tick: blueprint.flow.delay @520,0",
        "        duration = 1",
        ...source,
        "    init -> show -> tick",
        "    tick.completed -> show.in",
        `    ${value} -> show.text`,
    );
}

export const DISPLAY_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "totalPlaytimeText",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Total playtime", description: "Shows the time played across every playthrough." },
            zh: { title: "累计游玩时长", description: "显示历次游玩的累计时长" },
            ja: { title: "累計プレイ時間", description: "これまでのすべてのプレイを合わせたプレイ時間を表示する" },
        },
        graph: () => everySecondGraph(
            "format.result",
            "    total: blueprint.game.getTotalPlaytime @0,160",
            "    format: blueprint.time.formatDuration style=hoursMinutesSeconds @260,160",
            "    total.totalPlaytimeMilliseconds -> format.milliseconds",
        ),
    },
    {
        id: "playtimeText",
        category: "display",
        owners: WIDGET_OWNERS,
        featured: 5,
        text: {
            en: { title: "Playtime", description: "Shows how long the current game has been played." },
            zh: { title: "游玩时长", description: "显示当前游戏进度的游玩时长" },
            ja: { title: "プレイ時間", description: "現在のゲームのプレイ時間を表示する" },
        },
        // The game's own reading, which carries over a load: what a save written now would record.
        graph: () => everySecondGraph(
            "format.result",
            "    played: blueprint.game.getPlaytime @0,160",
            "    format: blueprint.time.formatDuration style=hoursMinutesSeconds @260,160",
            "    played.playtimeMilliseconds -> format.milliseconds",
        ),
    },
    {
        id: "clockText",
        category: "display",
        owners: WIDGET_OWNERS,
        featured: 6,
        text: {
            en: { title: "Clock", description: "Shows the current time in the format of the player's system." },
            zh: { title: "时钟", description: "按玩家系统的格式显示当前时间" },
            ja: { title: "時計", description: "現在の時刻をプレイヤーのシステムの形式で表示する" },
        },
        // An empty locale is the player's system locale, so the time reads as the system clock does.
        graph: () => everySecondGraph(
            "format.result",
            "    now: blueprint.time.now @0,160",
            "    format: blueprint.time.formatLocalized @260,160",
            "        dateStyle = none",
            "        timeStyle = short",
            "        locale = \"\"",
            "    now.timestamp -> format.timestamp",
        ),
    },
    {
        id: "speakerNameText",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Speaker name", description: "Shows the name of whoever is speaking and follows each new line." },
            zh: { title: "说话人名字", description: "显示正在说话的角色名字，随每句台词更新" },
            ja: { title: "話者の名前", description: "話しているキャラクターの名前を表示し、台詞ごとに更新する" },
        },
        // For a text on the dialogue box: On Flush runs there as each line arrives. The narrator has
        // no name, so the text empties for a narrated line.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    flush: blueprint.event.head.flush @0,150",
            "    name: blueprint.game.getNametag @260,240",
            "    show: blueprint.text.setText @520,60",
            "    init -> show",
            "    flush -> show",
            "    name.nametag -> show.text",
        ),
    },
    {
        id: "speakerPortraitImage",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Speaker portrait", description: "Shows the portrait of whoever is speaking and follows each new line." },
            zh: { title: "说话人头像", description: "显示正在说话的角色头像，随每句台词更新" },
            ja: { title: "話者の顔画像", description: "話しているキャラクターの顔画像を表示し、台詞ごとに更新する" },
        },
        // The same shape for a picture on the dialogue box. A line with no portrait - the narrator's,
        // or a character's that has none - clears the picture rather than leaving the last one up.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    flush: blueprint.event.head.flush @0,150",
            "    portrait: blueprint.game.getSpeakerAvatar @260,240",
            "    show: blueprint.image.setImageAsset @520,60",
            "    init -> show",
            "    flush -> show",
            "    portrait.avatar -> show.asset",
        ),
    },
    {
        id: "endingCountText",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Endings reached", description: "Shows how many of the story's endings the player has reached, as 3 / 5." },
            zh: { title: "结局达成数", description: "以「3 / 5」的形式显示玩家已达成的结局数量" },
            ja: { title: "到達したエンディング数", description: "プレイヤーが到達したエンディングの数を「3 / 5」の形で表示する" },
        },
        // Reached endings are kept across playthroughs, so the count is the player's, not one game's.
        // The story is the default one; a project with several picks the one this page is about, on
        // both Get Endings - one for each number, since a node's output feeds one input.
        graph: facts => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.text.setText @1300,0",
            "    endings: blueprint.game.getEndings @0,160",
            field("storyId", facts.gameStart?.storyId),
            "    reachedOnly: blueprint.collection.arrayFilter @260,160",
            "        key = isReached",
            "    yes: blueprint.data.booleanLiteral @0,320",
            "        value = true",
            "    allEndings: blueprint.game.getEndings @260,460",
            field("storyId", facts.gameStart?.storyId),
            "    reached: blueprint.collection.arrayLength @520,160",
            "    total: blueprint.collection.arrayLength @520,460",
            "    reachedText: blueprint.string.toString @780,160",
            "    totalText: blueprint.string.toString @780,460",
            "    joined: blueprint.string.concat @1040,160",
            "        __dynamicInputPinIds = [\"in_1\"]",
            "        b = \" / \"",
            "    init -> show",
            "    endings.endings -> reachedOnly.array",
            "    yes.value -> reachedOnly.value",
            "    reachedOnly.result -> reached.array",
            "    allEndings.endings -> total.array",
            "    reached.length -> reachedText.value",
            "    total.length -> totalText.value",
            "    reachedText.result -> joined.a",
            "    totalText.result -> joined.in_1",
            "    joined.result -> show.text",
        ),
        choices: { endings: ["storyId"], allEndings: ["storyId"] },
    },
    {
        id: "dateText",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Date", description: "Shows today's date in the format of the player's system." },
            zh: { title: "日期", description: "按玩家系统的格式显示今天的日期" },
            ja: { title: "日付", description: "今日の日付をプレイヤーのシステムの形式で表示する" },
        },
        // Written once as the widget starts. Unlike the clock it does not keep time: a page left open
        // across midnight is the one case it would miss, and a loop for that is not worth running.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.text.setText @520,0",
            "    now: blueprint.time.now @0,160",
            "    format: blueprint.time.formatLocalized @260,160",
            "        dateStyle = long",
            "        timeStyle = none",
            "        locale = \"\"",
            "    init -> show",
            "    now.timestamp -> format.timestamp",
            "    format.result -> show.text",
        ),
    },
    {
        id: "dayNightImage",
        category: "display",
        owners: WIDGET_OWNERS,
        text: {
            en: {
                title: "Day and night picture",
                description: "Shows one picture from 6:00 to 18:00 on the player's clock and another the rest of the time.",
            },
            zh: { title: "按时段切换图片", description: "按玩家电脑上的时间，6 点到 18 点显示白天的图片，其余时间显示夜晚的图片" },
            ja: { title: "昼と夜で画像を切り替える", description: "プレイヤーの時計で 6 時から 18 時は昼の画像、それ以外は夜の画像を表示する" },
        },
        // Chosen once as the picture starts, as a title screen that greets the player by the hour
        // does; nothing changes under a player who sits on the page across six o'clock. The hour is
        // read twice, once for each end of the day, since a node's output feeds one input.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    now: blueprint.time.now @0,160",
            "    parts: blueprint.time.parts @260,160",
            "    fromMorning: blueprint.compare.greaterThanOrEqual @520,160",
            "        b = 6",
            "    nowAgain: blueprint.time.now @0,400",
            "    partsAgain: blueprint.time.parts @260,400",
            "    beforeEvening: blueprint.compare.lessThan @520,400",
            "        b = 18",
            "    daytime: blueprint.boolean.and @780,160",
            "    branch: if @1040,0",
            "    day: blueprint.image.setImageAsset @1300,0",
            "    night: blueprint.image.setImageAsset @1300,160",
            "    init -> branch",
            "    now.timestamp -> parts.timestamp",
            "    parts.hour -> fromMorning.a",
            "    nowAgain.timestamp -> partsAgain.timestamp",
            "    partsAgain.hour -> beforeEvening.a",
            "    fromMorning.result -> daytime.a",
            "    beforeEvening.result -> daytime.b",
            "    daytime.result -> branch.condition",
            "    branch.true -> day",
            "    branch.false -> night",
        ),
        choices: { day: ["asset"], night: ["asset"] },
    },
];
