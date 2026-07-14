import type { LocaleNamespace } from "../types";

export const placeholders = {
    story: {
        title: "故事",
        description: "章节、场景及剧情结构将显示于此",
    },
    localization: {
        title: "本地化",
        description: "翻译表及语言素材将在此处管理",
    },
} satisfies LocaleNamespace<"placeholders">;
