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
        storyFlow: "场景流程",
        localization: "本地化",
        voice: "配音",
        assets: "素材",
        console: "控制台",
        storyMotion: "故事动效",
        dashboard: "仪表盘",
        audioPreview: "音频预览",
        imagePreview: "图片预览",
        videoPreview: "视频预览",
        fontPreview: "字体预览",
        jsonPreview: "JSON 预览",
        search: "搜索",
        keybindings: "快捷键",
        history: "历史",
        notifications: "通知",
    },
} satisfies LocaleNamespace<"placeholders">;
