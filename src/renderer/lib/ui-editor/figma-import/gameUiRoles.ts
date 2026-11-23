/**
 * Reading what a layer is for in a design of the game screen.
 *
 * A designer draws the dialogue box, the choice menu and the quick menu over a mock of the running
 * game, in one frame. Each of those belongs in its own Game UI slot, and some of their layers do a
 * job (the line of dialogue, the speaker's name, the Auto button) rather than only being looked at.
 * Both are read off the layer names, in every language Studio speaks, the way `buttonStates.ts` reads
 * button states: split on the usual separators and matched word by word, with a CJK word also counted
 * at the end of a part's name (`角色名字`) - though never at the end of a slot's.
 *
 * Comments in English per project convention.
 */

import type { UIStageSlotId } from "@shared/types/ui-editor/document";

/** The Game UI slots a design can fill. NVL is left out: its page is a list the design cannot show. */
export type GameUiSlot = Extract<UIStageSlotId, "dialog" | "choice" | "onStage" | "notification">;

export const GAME_UI_SLOTS: readonly GameUiSlot[] = ["dialog", "choice", "onStage", "notification"];

const SLOT_WORDS: Record<GameUiSlot, readonly string[]> = {
    dialog: [
        "dialog", "dialogue", "dialogbox", "dialoguebox", "textbox", "textwindow", "messagebox", "messagewindow", "say",
        "对话框", "对白框", "对话", "文本框", "台词框", "会话框", "對話框",
        "ダイアログ", "メッセージウィンドウ", "テキストボックス", "テキストウィンドウ", "会話ウィンドウ",
    ],
    choice: [
        "choice", "choices", "choicemenu", "menuchoice",
        "选项", "选择", "选择肢", "選項",
        "選択肢",
    ],
    onStage: [
        "quickmenu", "quick", "systemmenu", "systembuttons", "hud",
        "快捷菜单", "快速菜单", "快捷按钮", "系统菜单", "系统按钮",
        "クイックメニュー", "システムメニュー", "システムボタン",
    ],
    notification: [
        "notification", "notifications", "notify", "toast", "toasts",
        "通知", "提示",
        "お知らせ",
    ],
};

/** A layer inside the dialogue box that does a job. */
export type DialogPart = "sentence" | "name" | "avatar";

const DIALOG_PART_WORDS: Record<DialogPart, readonly string[]> = {
    sentence: ["sentence", "line", "text", "body", "dialogue", "dialog", "台词", "对白", "正文", "文本", "内容", "セリフ", "台詞", "本文", "テキスト"],
    name: ["name", "nametag", "speaker", "名字", "名称", "姓名", "说话人", "角色名", "名前", "話者", "ネーム"],
    avatar: ["avatar", "face", "portrait", "headshot", "头像", "立绘头像", "アバター", "顔", "フェイス"],
};

/** A quick-menu button's job. */
export type QuickMenuAction = "auto" | "skip" | "log" | "save" | "load" | "config" | "hide";

export const QUICK_MENU_ACTIONS: readonly QuickMenuAction[] = ["auto", "skip", "log", "save", "load", "config", "hide"];

/** The quick-menu jobs that open a page, and so need the project's page for them. */
export type QuickMenuPage = Extract<QuickMenuAction, "log" | "save" | "load" | "config">;

export const QUICK_MENU_PAGES: readonly QuickMenuPage[] = ["log", "save", "load", "config"];

const QUICK_MENU_WORDS: Record<QuickMenuAction, readonly string[]> = {
    auto: ["auto", "autoplay", "autoforward", "自动", "自动播放", "オート"],
    skip: ["skip", "fastforward", "ff", "跳过", "快进", "スキップ"],
    log: ["log", "backlog", "history", "日志", "历史", "回想", "记录", "履歴", "ログ", "バックログ"],
    save: ["save", "qsave", "quicksave", "存档", "保存", "セーブ"],
    load: ["load", "qload", "quickload", "读档", "读取", "载入", "加载", "ロード"],
    config: ["config", "settings", "setting", "options", "option", "preferences", "prefs", "设置", "设定", "系统", "コンフィグ", "設定", "オプション"],
    hide: ["hide", "hidebox", "隐藏", "关闭对话框", "非表示", "消す"],
};

const SEPARATORS = /[\s_\-.@/\\()（）[\]【】=,，、:：]+/;
const CJK = /[぀-ヿ㐀-鿿]/;

function matches(name: string, words: readonly string[], cjkSuffix: boolean): boolean {
    const lower = name.toLowerCase();
    const tokens = lower.split(SEPARATORS).filter(Boolean);
    const joined = tokens.join("");
    if (words.some(word => tokens.includes(word) || joined === word)) {
        return true;
    }
    const trimmed = name.trim();
    return cjkSuffix && words.some(word => CJK.test(word) && trimmed.endsWith(word));
}

function firstMatch<K extends string>(
    name: string,
    table: Record<K, readonly string[]>,
    order: readonly K[],
    cjkSuffix = true,
): K | null {
    if (!name) {
        return null;
    }
    for (const key of order) {
        if (matches(name, table[key], cjkSuffix)) {
            return key;
        }
    }
    return null;
}

/**
 * The Game UI slot a layer or frame is named for, or null. A slot word must stand on its own here,
 * never at the end of a longer CJK name: a page called 「设置选项」 is a settings page, not choices.
 */
export function gameUiSlotOfName(name: string): GameUiSlot | null {
    return firstMatch(name, SLOT_WORDS, GAME_UI_SLOTS, false);
}

/** The job a layer inside the dialogue box is named for, or null. The name is read before the line. */
export function dialogPartOfName(name: string): DialogPart | null {
    return firstMatch(name, DIALOG_PART_WORDS, ["name", "avatar", "sentence"]);
}

/** The job a quick-menu button is named for, or null. */
export function quickMenuActionOfName(name: string): QuickMenuAction | null {
    return firstMatch(name, QUICK_MENU_WORDS, QUICK_MENU_ACTIONS);
}

/** Which quick-menu page a project page is, by its name, or null. */
export function quickMenuPageOfName(name: string): QuickMenuPage | null {
    const action = quickMenuActionOfName(name);
    return action && (QUICK_MENU_PAGES as readonly string[]).includes(action) ? (action as QuickMenuPage) : null;
}
