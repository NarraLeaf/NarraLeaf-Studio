import type { LocaleNamespace } from "../types";

export const devMode = {
    title: "开发模式",
    dismiss: "关闭",
    surfaceUnavailable: "界面不可用",
    waitingPayload: "正在等待开发模式数据…",
    surfaceNotFound: "未找到界面：{surfaceId}",
    devtools: {
        title: "蓝图开发者工具",
        menuAria: "预览调试工具",
        openMenu: "打开预览调试工具菜单",
        closeMenu: "关闭预览调试工具菜单",
        panelsAria: "调试面板",
    },
    tabs: {
        blueprints: "蓝图",
        output: "输出",
        scope: "作用域",
    },
    blueprints: {
        empty: "暂无蓝图",
        openWorkspace: "工作区",
        cannotOpen: "无法从预览中打开该蓝图",
        openFailed: "无法打开蓝图",
    },
    output: {
        logLevel: "日志级别",
        empty: "暂无输出",
        level: {
            log: "日志",
            verbose: "详细",
        },
    },
    scope: {
        surface: "界面",
        global: "全局",
        persistence: "持久化",
        widget: "控件",
        hover: "悬停",
        active: "激活",
        focus: "焦点",
        variants: "变体",
    },
} satisfies LocaleNamespace<"devMode">;
