import type { LocaleNamespace } from "../types";

export const dashboard = {
    loading: "正在读取项目…",
    failed: "无法读取项目统计数据",
    retry: "重试",

    header: {
        lastActive: "最近活跃",
        trackedSince: "开始统计",
        never: "暂无",
    },

    units: {
        words: {
            other: "{count} 字",
        },
        lines: {
            other: "{count} 句",
        },
        nodes: {
            other: "{count} 个节点",
        },
        days: {
            other: "{count} 天",
        },
    },

    duration: {
        hoursMinutes: "{hours} 小时 {minutes} 分",
        minutes: "{minutes} 分",
        minutesSeconds: "{minutes} 分 {seconds} 秒",
        seconds: "{seconds} 秒",
    },

    relative: {
        justNow: "刚刚",
        minutesAgo: "{count} 分钟前",
        hoursAgo: "{count} 小时前",
        daysAgo: "{count} 天前",
    },

    scale: {
        title: "规模",
        scenes: "场景",
        dialogueLines: "对话行",
        totalWords: "字数",
        characters: "角色",
        assets: "资源",
        blueprints: "蓝图",
        uiSurfaces: "界面",
        variables: "变量",
    },

    activity: {
        title: "写作活动",
        description: "最近 30 天每天新增的字数",
        wordsWritten: "写作字数",
        activeTime: "活跃时长",
        edits: "编辑次数",
        streak: "连续写作",
        streakNone: "暂无连续记录",
        peak: "峰值 {words}",
        empty: "还没有写作记录，记录到写作的那天起会显示柱状图",
        chartLabel: "最近 30 天每天的写作字数",
        tooltip: {
            added: "{date} · 新增 {words}",
            removed: "{date} · 删减 {words}",
            unchanged: "{date} · 无变化",
            start: "{date} · 统计从这天开始，没有可对比的基准",
            untracked: "{date} · 早于统计开始时间",
        },
    },

    builds: {
        title: "构建记录",
        ok: "成功",
        failed: "失败",
        empty: "暂无构建记录",
        emptyHint: "该项目的构建完成后会显示在这里",
    },

    structure: {
        title: "结构",
        endings: "结局",
        branches: "分支",
        unreachable: "不可达场景",
        unreachableHint: "从入口场景出发没有跳转路径能到达这些场景",
        emptyScenes: "空场景",
        emptyScenesHint: "这些场景还没有任何内容",
        healthy: "没有不可达或空的场景",
        more: "还有 {count} 个",
    },

    cast: {
        title: "角色",
        description: "按字数排列的有台词角色",
        empty: "还没有角色说过话",
    },

    scenes: {
        title: "场景",
        description: "按字数排列的最长场景",
        empty: "还没有场景包含文字",
    },

    localization: {
        title: "本地化",
        translated: "已翻译",
        reviewed: "已审校",
        untranslated: "未翻译",
        summary: "已翻译 {completed} / {total}",
    },

    footer: {
        openOnWorkspaceOpen: "每次进入工作区时显示此仪表盘",
        clear: "清空本项目统计数据",
        clearConfirm: "确定清空本项目的统计数据？",
        clearDetail:
            "仅清除已记录的活动历史：写作曲线、活跃时长、编辑次数与构建记录。场景数、字数、角色数与本地化进度都是从项目本身实时计算的，不会受到影响。此操作无法撤销。",
    },
} satisfies LocaleNamespace<"dashboard">;
