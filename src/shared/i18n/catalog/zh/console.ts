import type { LocaleNamespace } from "../types";

export const console = {
    level: {
        error: "错误",
        warning: "警告",
        success: "成功",
        info: "信息",
        verbose: "详细",
    },
    channelsAria: "控制台通道",
    filterLevels: "筛选级别",
    emptyFiltered: "没有符合当前筛选的日志",
    emptyChannel: "还没有 {label} 输出",
    entryEmpty: "（空）",
} satisfies LocaleNamespace<"console">;
