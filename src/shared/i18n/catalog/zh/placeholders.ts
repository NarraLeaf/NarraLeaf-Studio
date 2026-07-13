import type { LocaleNamespace } from "../types";

export const placeholders = {
    story: {
        title: "故事",
        description: "章节、场景和故事结构将显示在这里。",
    },
    localization: {
        title: "本地化",
        description: "翻译表和语言资源将在这里管理。",
    },
} satisfies LocaleNamespace<"placeholders">;
