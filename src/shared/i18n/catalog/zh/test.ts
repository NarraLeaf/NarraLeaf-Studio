import type { LocaleNamespace } from "../types";

/**
 * `test` 简体中文。
 *
 * 术语固定：这里的「测试」指作者对**自己的游戏**跑的检查（能不能走到结局、断网还活不活），
 * 与仓库自己的单元测试无关。判定叫「通过／失败／跳过」，宿主给出的另外三种是「已取消／出错」；
 * 一条证据叫「结果」，级别是错误／警告／提示。界面上不写解释性句子。
 */
export const test = {
    action: {
        open: "测试…",
        run: "运行测试",
        stop: "停止测试",
    },
    statusBar: {
        label: "测试",
    },
    category: {
        integrity: "完整性",
        runtime: "运行时",
        compatibility: "兼容性",
        custom: "自定义",
    },
    presentation: {
        headless: "无窗口",
        windowed: "有窗口",
    },
    picker: {
        title: "运行测试",
        start: "开始",
        empty: "尚未注册任何测试",
    },
    status: {
        running: "运行中",
        passed: "通过",
        failed: "失败",
        skipped: "已跳过",
        cancelled: "已取消",
        errored: "出错",
    },
    severity: {
        error: "错误",
        warning: "警告",
        info: "提示",
    },
    report: {
        title: "测试报告",
        empty: "没有任何结果",
        none: "尚未运行",
        rerun: "重新运行",
        severityFilter: "级别",
        filterAll: "全部",
        findings: "{errors} 个错误，{warnings} 个警告，{infos} 个提示",
        durationSeconds: "{seconds} 秒",
        durationMinutes: "{minutes} 分 {seconds} 秒",
    },
    reason: {
        frozen: "工作区冻结时不可用",
        alreadyRunning: "已有测试正在运行",
    },
    console: {
        channel: "测试",
        started: "{title} 开始",
        finished: "{title} {status}，用时 {duration}",
        finding: "{severity} {message}",
    },
    toast: {
        passed: "{title} 通过",
        failed: "{title} 失败",
        skipped: "{title} 已跳过",
        cancelled: "{title} 已取消",
        errored: "{title} 未能运行",
    },
    builtin: {
        projectDiagnostics: {
            title: "工程诊断",
            description: "将工程检查的全部规则作为一项测试运行",
            summary: {
                passed: "没有发现问题",
                failed: "{errors} 个错误，{warnings} 个警告",
            },
        },
    },
} satisfies LocaleNamespace<"test">;
