/**
 * Display: a text that shows something the game knows - play time, the date, a setting's value.
 *
 * Comments in English per project convention.
 */

import { Clock, History, Timer } from "lucide-react";
import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, WIDGET_OWNERS } from "./templateText";

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
        icon: History,
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
        icon: Timer,
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
        icon: Clock,
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
];
