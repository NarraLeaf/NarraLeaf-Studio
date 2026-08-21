import type { LocaleNamespace } from "../types";

/**
 * `dictionary` 中文。工程自己的词汇表，在词典面板里编辑。
 *
 * 标题是名词短语；字段做什么由字段名和故事编辑器的行为说明，不在旁边写解释。
 * 「注音」沿用富文本工具条的既有译法（见 `story.richText.ruby`），读音本身叫「读音」。
 */
export const dictionary = {
    search: "搜索词条",
    add: "添加词条",
    newTerm: "新词条",
    empty: "尚无词条",
    noMatches: "无匹配词条",
    remove: "删除词条",
    addSelection: "将“{term}”加入词典",
    field: {
        term: "词条",
        reading: "读音",
        variants: "异体写法",
        note: "备注",
    },
    options: {
        suggestReadings: "建议读音",
        checkVariants: "检查异体写法",
    },
} satisfies LocaleNamespace<"dictionary">;
