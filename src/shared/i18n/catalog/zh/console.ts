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
    outputFallback: "输出",
    channels: {
        blueprint: "蓝图",
        build: "构建",
        story: "故事",
        blueprintDescription: "蓝图运行时与图表诊断",
        buildDescription: "构建、打包与预览流程输出",
        storyDescription: "故事场景预览诊断与警告",
    },
} satisfies LocaleNamespace<"console">;
