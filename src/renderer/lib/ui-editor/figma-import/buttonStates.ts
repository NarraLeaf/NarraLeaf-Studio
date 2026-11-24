/**
 * Reading a button state out of a layer, variant or file name.
 *
 * Artists name the looks of a button in every language Studio speaks and several conventions at
 * once: `normal` / `hover` / `pressed` layers in a group, `start_hover.png`, a Figma variant
 * `State=Hover`, 「悬停」「按下」. A name is split on the usual separators and matched word by word,
 * so `btn_start_hover` is a hover state and `hovercraft` is not; a CJK word, which has no separators,
 * also counts at the end of a name (`开始悬停`).
 *
 * Comments in English per project convention.
 */

/**
 * `selected` is the look a button keeps while what it stands for is on - Auto or Skip running, the
 * current tab - and becomes the button's `selected` variant rather than a condition.
 */
export type ButtonState = "default" | "hover" | "pressed" | "disabled" | "selected";

export const BUTTON_STATES: readonly ButtonState[] = ["default", "hover", "pressed", "disabled", "selected"];

const WORDS: Record<ButtonState, readonly string[]> = {
    default: ["normal", "default", "idle", "up", "rest", "base", "普通", "默认", "常态", "正常", "通常", "ノーマル", "デフォルト"],
    hover: ["hover", "hovered", "over", "mouseover", "highlight", "highlighted", "悬停", "悬浮", "高亮", "经过", "ホバー", "オーバー"],
    pressed: ["pressed", "press", "down", "active", "click", "clicked", "按下", "点击", "押下", "プレス"],
    disabled: ["disabled", "disable", "inactive", "禁用", "不可用", "置灰", "無効", "无效"],
    selected: ["selected", "on", "checked", "toggled", "lit", "选中", "已选", "开启", "オン", "選択中"],
};

const SEPARATORS = /[\s_\-.@/\\()（）[\]【】=,，、:：]+/;
const CJK = /[぀-ヿ㐀-鿿]/;

function tokensOf(name: string): string[] {
    return name.toLowerCase().split(SEPARATORS).filter(Boolean);
}

/** The state a name stands for, or null when it names none. */
export function buttonStateOfName(name: string): ButtonState | null {
    const tokens = tokensOf(name);
    for (const state of BUTTON_STATES) {
        if (WORDS[state].some(word => tokens.includes(word))) {
            return state;
        }
    }
    const trimmed = name.trim();
    for (const state of BUTTON_STATES) {
        if (WORDS[state].some(word => CJK.test(word) && trimmed.endsWith(word) && trimmed.length > word.length)) {
            return state;
        }
    }
    return null;
}

/**
 * The name with its state word taken out - what the files `start.png`, `start_hover.png` and
 * `start_pressed.png` have in common. A name with no state word is returned trimmed, and is the
 * default look of the button of that name.
 */
export function buttonBaseName(name: string): string {
    const state = buttonStateOfName(name);
    if (!state) {
        return name.trim();
    }
    const words = WORDS[state];
    const parts = name.split(/([\s_\-.@/\\()（）[\]【】=,，、:：]+)/);
    const kept = parts.filter(part => !words.includes(part.toLowerCase()));
    let base = kept.join("");
    if (base.length === name.length) {
        // A CJK state word at the end, with nothing separating it.
        const word = words.find(candidate => CJK.test(candidate) && name.trim().endsWith(candidate));
        if (word) base = name.trim().slice(0, -word.length);
    }
    return base.replace(/^[\s_\-.@=,，、:：]+|[\s_\-.@=,，、:：]+$/g, "").trim();
}
