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
    moduleTitles: {
        welcome: "欢迎",
        project: "项目",
        properties: "属性",
        characters: "角色",
        story: "故事",
        localization: "本地化",
        assets: "素材",
        console: "控制台",
        storyMotion: "故事动效",
        dashboard: "仪表盘",
        audioPreview: "音频预览",
        imagePreview: "图片预览",
        search: "搜索",
        keybindings: "快捷键",
    },
} satisfies LocaleNamespace<"placeholders">;
