import { pickPreferredLocale } from "@shared/i18n/preferredLocale";

/**
 * The few sentences the game's own process puts in front of a player, in the three languages
 * Studio ships.
 *
 * Written out here rather than read from the catalog, and that is deliberate: `@shared/i18n`
 * carries every Studio string in every language, so importing it would put the whole editor's
 * text into the main bundle of every shipped game in order to say six sentences. The renderer's
 * `game.crash.*` keys are the copy this one has to be kept in step with, and the lines that say
 * the same thing are worded identically so the two can be read side by side.
 *
 * The language is the machine's. A player reads these at the moment the game has stopped working,
 * which is exactly the moment nothing the project chose can be relied on - not the pack, not the
 * stored language, not the game's own locale. It is also not the author's to set: a Japanese
 * player of an English game is told what happened in Japanese.
 */

export const SHELL_LOCALES = ["en", "zh", "ja"] as const;

export type ShellLocale = typeof SHELL_LOCALES[number];

const FALLBACK_SHELL_LOCALE: ShellLocale = "en";

interface ShellStrings {
    /** Headline of the question asked about a window that has stopped answering. */
    hangMessage: string;
    /** What restarting costs, said before it is offered. */
    hangDetail: string;
    hangKeepWaiting: string;
    hangRestart: string;
    /** Said once the process is going down and nothing else will be shown. */
    fatalClose: string;
    /** `{path}` - where the report was written. Identical to `game.crash.logAt`. */
    logAt: string;
    /** `{reason}` - Chromium's word for how the page process ended. */
    windowStopped: string;
    /** `{reason}`, `{exitCode}` - handed to the crash page, which is all that survives the death. */
    displayProcessExited: string;
    /**
     * A pack, a patch or a DLC written for a newer version of this game. Identical to
     * `game.crash.contentTooNew`, which the page shows for the same file on the web export.
     */
    contentTooNew: string;
    /** `{files}` - the patch or DLC files the game left unapplied, by name. */
    contentNotApplied: string;
    /**
     * `{name}` - window title of a preview running loose files, the everyday fast path.
     *
     * The one entry here an author reads rather than a player: a preview window is a game window,
     * and without this the two forms of it are indistinguishable from the taskbar.
     */
    previewTitle: string;
    /** `{name}` - window title of a preview that seals its content the way a shipped build does. */
    previewAsShippedTitle: string;
}

const STRINGS: Record<ShellLocale, ShellStrings> = {
    en: {
        hangMessage: "The game is not responding",
        hangDetail: "Restarting reopens the game at its title screen. Progress since the last save is lost.",
        hangKeepWaiting: "Keep waiting",
        hangRestart: "Restart",
        fatalClose: "The game has to close.",
        logAt: "The report is in {path}",
        windowStopped: "The game window stopped working ({reason}).",
        displayProcessExited: "The game's display process exited: {reason} (exit code {exitCode})",
        contentTooNew: "This content needs a newer version of the game.",
        contentNotApplied: "Not applied: {files}",
        previewTitle: "{name} · Preview",
        previewAsShippedTitle: "{name} · Preview as shipped",
    },
    zh: {
        hangMessage: "游戏未响应",
        hangDetail: "重新启动会回到游戏的标题画面。上次存档之后的进度会丢失。",
        hangKeepWaiting: "继续等待",
        hangRestart: "重新启动",
        fatalClose: "游戏将关闭。",
        logAt: "报告位于 {path}",
        windowStopped: "游戏窗口已停止工作（{reason}）",
        displayProcessExited: "游戏的显示进程已退出：{reason}（退出码 {exitCode}）",
        contentTooNew: "此内容需要更新版本的游戏。",
        contentNotApplied: "未应用：{files}",
        previewTitle: "{name} · 预览",
        previewAsShippedTitle: "{name} · 按出货方式预览",
    },
    ja: {
        hangMessage: "ゲームが応答しない",
        hangDetail: "再起動するとタイトル画面から始まる。最後のセーブ以降の進行は失われる",
        hangKeepWaiting: "待機を続ける",
        hangRestart: "再起動",
        fatalClose: "ゲームは終了する。",
        logAt: "レポートは {path} にある",
        windowStopped: "ゲームウィンドウが停止した（{reason}）",
        displayProcessExited: "ゲームの表示プロセスが終了した：{reason}（終了コード {exitCode}）",
        contentTooNew: "このコンテンツには新しいバージョンのゲームが必要。",
        contentNotApplied: "適用されなかった：{files}",
        previewTitle: "{name} · プレビュー",
        previewAsShippedTitle: "{name} · 出荷どおりのプレビュー",
    },
};

export interface ShellText {
    readonly locale: ShellLocale;
    readonly hangMessage: string;
    readonly hangDetail: string;
    readonly hangKeepWaiting: string;
    readonly hangRestart: string;
    readonly fatalClose: string;
    logAt(path: string): string;
    windowStopped(reason: string): string;
    displayProcessExited(reason: string, exitCode: number): string;
    readonly contentTooNew: string;
    contentNotApplied(files: readonly string[]): string;
    /** The window title for a preview of `name`, saying which of the two forms it is running. */
    previewTitle(name: string, asShipped: boolean): string;
}

function fill(template: string, params: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? params[name] : match);
}

/**
 * The shell text for a machine that asks for these languages, in this order.
 *
 * Pure, and the whole locale decision with it, so the wording can be pinned by a test rather than
 * only by shipping a build to a machine set to Japanese.
 */
export function resolveShellText(tags: readonly string[]): ShellText {
    const locale = pickPreferredLocale(tags, SHELL_LOCALES, FALLBACK_SHELL_LOCALE);
    const strings = STRINGS[locale];
    return {
        locale,
        hangMessage: strings.hangMessage,
        hangDetail: strings.hangDetail,
        hangKeepWaiting: strings.hangKeepWaiting,
        hangRestart: strings.hangRestart,
        fatalClose: strings.fatalClose,
        logAt: path => fill(strings.logAt, { path }),
        windowStopped: reason => fill(strings.windowStopped, { reason }),
        displayProcessExited: (reason, exitCode) =>
            fill(strings.displayProcessExited, { reason, exitCode: String(exitCode) }),
        contentTooNew: strings.contentTooNew,
        // File names are identifiers, joined the way a list of them reads in every language here.
        contentNotApplied: files => fill(strings.contentNotApplied, { files: files.join(", ") }),
        previewTitle: (name, asShipped) =>
            fill(asShipped ? strings.previewAsShippedTitle : strings.previewTitle, { name }),
    };
}
