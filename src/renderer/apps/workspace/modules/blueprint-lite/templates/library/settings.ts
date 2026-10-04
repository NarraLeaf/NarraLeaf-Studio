/**
 * Settings: a slider or a switch on a settings page that shows a preference and changes it.
 *
 * Each one reads the preference when the widget starts and writes it whenever the player moves the
 * widget. Setting a slider's value or a switch's state from a graph does not raise the widget's own
 * Value Changed or Changed - only the player's hand does - so the value read on start is not
 * written straight back. A widget is not told when a preference changes somewhere else (On
 * Preference Changed is an event of the game and of a page), so what it shows is the value as it
 * stood when the widget started.
 *
 * Comments in English per project convention.
 */

import type { BlueprintLayerTemplate } from "../blueprintLayerTemplates";
import { lines, WIDGET_OWNERS } from "./templateText";

/**
 * A slider over one of the four volumes, which differ only in the preference they move.
 *
 * The game holds a volume as 0 to 1 and the slider runs over its default 0 to 100, so the volume is
 * multiplied by 100 on its way onto the slider and divided by 100 on its way back: the slider reads
 * as a percentage. A slider given another range in the inspector keeps the same mapping, so its top
 * would no longer be full volume.
 */
function volumeSliderGraph(get: string, set: string, pin: string): string {
    return lines(
        "    init: blueprint.event.head.init @0,0",
        "    show: blueprint.slider.setValue @520,0",
        `    volume: blueprint.game.${get} @0,140`,
        "    toPercent: blueprint.math.multiply @260,140",
        "        b = 100",
        "    changed: blueprint.event.head.sliderValueChanged @0,320",
        `    set: blueprint.game.${set} @520,320`,
        "    fromPercent: blueprint.math.divide @260,460",
        "        b = 100",
        "    init -> show",
        `    volume.${pin} -> toPercent.a`,
        "    toPercent.result -> show.value",
        "    changed -> set",
        "    changed.value -> fromPercent.a",
        `    fromPercent.result -> set.${pin}`,
    );
}

/** A switch over one on/off preference, whose getter and setter share the pin name. */
function preferenceSwitchGraph(get: string, set: string, pin: string): string {
    return lines(
        "    init: blueprint.event.head.init @0,0",
        "    show: blueprint.switch.setChecked @260,0",
        `    current: blueprint.game.${get} @0,140`,
        "    changed: blueprint.event.head.switchChanged @0,320",
        `    set: blueprint.game.${set} @260,320`,
        "    init -> show",
        `    current.${pin} -> show.checked`,
        "    changed -> set",
        `    changed.checked -> set.${pin}`,
    );
}

export const SETTINGS_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "masterVolumeSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 4,
        text: {
            en: { title: "Master volume slider", description: "Shows the master volume when the page opens and changes it when moved." },
            zh: { title: "总音量滑块", description: "页面打开时显示总音量，拖动时更改总音量" },
            ja: { title: "全体の音量スライダー", description: "ページを開くと全体の音量を表示し、動かすと変更する" },
        },
        graph: () => volumeSliderGraph("getGlobalVolume", "setGlobalVolume", "globalVolume"),
    },
    {
        id: "musicVolumeSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 1,
        text: {
            en: { title: "Music volume slider", description: "Shows the music volume when the page opens and changes it when moved." },
            zh: { title: "音乐音量滑块", description: "页面打开时显示音乐音量，拖动时更改音乐音量" },
            ja: { title: "音楽の音量スライダー", description: "ページを開くと音楽の音量を表示し、動かすと変更する" },
        },
        graph: () => volumeSliderGraph("getBgmVolume", "setBgmVolume", "bgmVolume"),
    },
    {
        id: "sfxVolumeSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 2,
        text: {
            en: { title: "SFX volume slider", description: "Shows the sound effect volume when the page opens and changes it when moved." },
            zh: { title: "音效音量滑块", description: "页面打开时显示音效音量，拖动时更改音效音量" },
            ja: { title: "効果音の音量スライダー", description: "ページを開くと効果音の音量を表示し、動かすと変更する" },
        },
        graph: () => volumeSliderGraph("getSoundVolume", "setSoundVolume", "soundVolume"),
    },
    {
        id: "voiceVolumeSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Voice volume slider", description: "Shows the voice volume when the page opens and changes it when moved." },
            zh: { title: "语音音量滑块", description: "页面打开时显示语音音量，拖动时更改语音音量" },
            ja: { title: "ボイスの音量スライダー", description: "ページを開くとボイスの音量を表示し、動かすと変更する" },
        },
        graph: () => volumeSliderGraph("getVoiceVolume", "setVoiceVolume", "voiceVolume"),
    },
    {
        id: "textSpeedSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 3,
        text: {
            en: { title: "Text speed slider", description: "Shows the text speed when the page opens and changes it when moved." },
            zh: { title: "文字速度滑块", description: "页面打开时显示文字速度，拖动时更改文字速度" },
            ja: { title: "文字表示の速さスライダー", description: "ページを開くと文字表示の速さを表示し、動かすと変更する" },
        },
        // Characters per second, one for one on the slider's default 0 to 100. The game refuses a
        // speed of zero, so the bottom of the track writes one instead.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.slider.setValue @520,0",
            "    speed: blueprint.game.getCps @260,140",
            "    changed: blueprint.event.head.sliderValueChanged @0,320",
            "    set: blueprint.game.setSentenceSpeed @520,320",
            "    atLeastOne: blueprint.math.max @260,460",
            "        b = 1",
            "    init -> show",
            "    speed.cps -> show.value",
            "    changed -> set",
            "    changed.value -> atLeastOne.a",
            "    atLeastOne.result -> set.cps",
        ),
    },
    {
        id: "autoForwardWaitSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Auto forward wait slider", description: "Shows the auto forward wait when the page opens and changes it when moved." },
            zh: { title: "自动前进等待时间滑块", description: "页面打开时显示自动前进的等待时间，拖动时更改等待时间" },
            ja: { title: "自動送りの待ち時間スライダー", description: "ページを開くと自動送りの待ち時間を表示し、動かすと変更する" },
        },
        // The game holds the wait in milliseconds. Sixty to a step puts the slider's default 0 to 100
        // over 0 to 6 seconds, with the engine's own default of 3 seconds in the middle.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.slider.setValue @520,0",
            "    wait: blueprint.game.getAutoForwardDelay @0,140",
            "    toSlider: blueprint.math.divide @260,140",
            "        b = 60",
            "    changed: blueprint.event.head.sliderValueChanged @0,320",
            "    set: blueprint.game.setAutoForwardDelay @520,320",
            "    toWait: blueprint.math.multiply @260,460",
            "        b = 60",
            "    init -> show",
            "    wait.autoForwardDelay -> toSlider.a",
            "    toSlider.result -> show.value",
            "    changed -> set",
            "    changed.value -> toWait.a",
            "    toWait.result -> set.autoForwardDelay",
        ),
    },
    {
        id: "fullscreenSwitch",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 1,
        text: {
            en: { title: "Fullscreen switch", description: "Shows whether the game is fullscreen and turns fullscreen on or off when switched." },
            zh: { title: "全屏开关", description: "显示游戏是否处于全屏，切换时进入或退出全屏" },
            ja: { title: "全画面スイッチ", description: "全画面かどうかを表示し、オンで全画面にし、オフで全画面をやめる" },
        },
        // Fullscreen also changes from a key, the window's own controls or another page, so the
        // switch follows On Fullscreen Changed as well as reading the window when it starts. That
        // head is not offered inside a component, so neither is this template.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    read: blueprint.app.getFullscreen @260,0",
            "    show: blueprint.switch.setChecked @520,0",
            "    elsewhere: blueprint.event.head.fullscreenChanged @0,180",
            "    follow: blueprint.switch.setChecked @520,180",
            "    on: blueprint.event.head.switchTurnedOn @0,360",
            "    enter: blueprint.app.setFullscreen mode=enter @260,360",
            "    off: blueprint.event.head.switchTurnedOff @0,520",
            "    exit: blueprint.app.setFullscreen mode=exit @260,520",
            "    init -> read -> show",
            "    read.isFullscreen -> show.checked",
            "    elsewhere -> follow",
            "    elsewhere.isFullscreen -> follow.checked",
            "    on -> enter",
            "    off -> exit",
        ),
    },
    {
        id: "skipReadTextSwitch",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 2,
        text: {
            en: {
                title: "Skip read text only switch",
                description: "Shows whether skipping stops at unread lines when the page opens, and changes it when switched.",
            },
            zh: { title: "跳过已读文本开关", description: "页面打开时显示是否只跳过已读文本，切换时更改该设置" },
            ja: { title: "既読のみスキップのスイッチ", description: "ページを開くと既読のみスキップするかを表示し、切り替えると変更する" },
        },
        graph: () => preferenceSwitchGraph("getSkipReadText", "setSkipReadText", "skipReadText"),
    },
    {
        id: "muteWhenUnfocusedSwitch",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 3,
        text: {
            en: {
                title: "Mute when unfocused switch",
                description: "Shows whether the game mutes behind other windows when the page opens, and changes it when switched.",
            },
            zh: { title: "失去焦点时静音开关", description: "页面打开时显示游戏窗口不在前台时是否静音，切换时更改该设置" },
            ja: { title: "非アクティブ時ミュートのスイッチ", description: "ページを開くと非アクティブ時にミュートするかを表示し、切り替えると変更する" },
        },
        graph: () => preferenceSwitchGraph("getMuteOnWindowBlur", "setMuteOnWindowBlur", "muteOnWindowBlur"),
    },
    {
        id: "autoForwardSwitch",
        category: "settings",
        owners: WIDGET_OWNERS,
        featured: 4,
        text: {
            en: {
                title: "Auto forward switch",
                description: "Shows whether auto forward is on when the page opens, and turns it on or off when switched.",
            },
            zh: { title: "自动前进开关", description: "页面打开时显示自动前进是否开启，切换时开启或关闭自动前进" },
            ja: { title: "自動送りのスイッチ", description: "ページを開くと自動送りがオンかを表示し、切り替えるとオンとオフを変更する" },
        },
        // Auto forward is kept with the player's settings, so what the switch sets is still set in
        // the next game, as it is when the A key or an auto forward button turns it on.
        graph: () => preferenceSwitchGraph("getAutoForward", "setAutoForward", "autoForward"),
    },
    {
        id: "skipSpeedSlider",
        category: "settings",
        owners: WIDGET_OWNERS,
        text: {
            en: { title: "Skip speed slider", description: "Shows how fast skipping goes when the page opens and changes it when moved." },
            zh: { title: "跳过速度滑块", description: "页面打开时显示跳过的速度，拖动时更改速度" },
            ja: { title: "スキップ速度スライダー", description: "ページを開くとスキップの速さを表示し、動かすと変更する" },
        },
        // The game holds the time between two skipped lines in milliseconds, where less is faster, so
        // the slider runs the other way: its default 0 to 100 is 200 down to 0 milliseconds, with the
        // engine's own 100 in the middle. The far end writes 10 instead, since an interval has to be
        // more than zero and a skip has to leave time to draw the line it passes.
        graph: () => lines(
            "    init: blueprint.event.head.init @0,0",
            "    show: blueprint.slider.setValue @780,0",
            "    interval: blueprint.game.getSkipInterval @0,140",
            "    fromSlow: blueprint.math.subtract @260,140",
            "        a = 200",
            "    toSlider: blueprint.math.divide @520,140",
            "        b = 2",
            "    changed: blueprint.event.head.sliderValueChanged @0,340",
            "    set: blueprint.game.setSkipInterval @780,340",
            "    doubled: blueprint.math.multiply @260,480",
            "        b = 2",
            "    toInterval: blueprint.math.subtract @520,480",
            "        a = 200",
            "    atLeastTen: blueprint.math.max @780,480",
            "        b = 10",
            "    init -> show",
            "    interval.skipInterval -> fromSlow.b",
            "    fromSlow.result -> toSlider.a",
            "    toSlider.result -> show.value",
            "    changed -> set",
            "    changed.value -> doubled.a",
            "    doubled.result -> toInterval.b",
            "    toInterval.result -> atLeastTen.a",
            "    atLeastTen.result -> set.skipInterval",
        ),
    },
];
