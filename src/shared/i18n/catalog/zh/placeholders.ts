import type { LocaleNamespace } from "../types";

export const placeholders = {
    moduleTitles: {
        welcome: "欢迎",
        project: "项目",
        properties: "属性",
        characters: "角色",
        story: "故事",
        localization: "本地化",
        voice: "配音",
        assets: "资产",
        console: "控制台",
        problems: "问题",
        agentLog: "Agent 日志",
        storyMotion: "故事动效",
        stageTimeline: "舞台时间轴",
        dashboard: "仪表盘",
        search: "搜索",
        keybindings: "快捷键",
        history: "历史",
        notifications: "通知",
        plugins: "插件",
        // 面板里三段分别叫「存档变量 / 持久变量 / 场景变量」，标题就是它们共同的那个词，不另造新词
        variables: "变量",
        dictionary: "词典",
        storyComments: "批注",
        collaboration: "协作",
    },
} satisfies LocaleNamespace<"placeholders">;
