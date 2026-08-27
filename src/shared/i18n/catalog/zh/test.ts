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
        parameters: "参数",
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
        parameterEmpty: "本工程中「{parameter}」没有可选值",
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
        walkthrough: {
            title: "结局通关",
            description: "从故事自己的入口场景开始，实际运行游戏走到某个结局",
            parameter: {
                ending: {
                    label: "结局",
                    description: "要走到的结局",
                    option: "{story} / {scene} / {ending}",
                    unnamed: "未命名结局",
                },
            },
            log: {
                planned: "已规划路线：{scenes} 个场景，{decisions} 处选择",
                choosing: "{scene}：选择「{option}」",
                improvised: "路线之外的选择，以「{option}」通过",
            },
            finding: {
                endingMissing: "该结局已不在故事中",
                noEntryPoint: "没有任何地方指定《{story}》从哪个场景开始",
                unreachable: "从《{story}》的起点走不到 {ending}",
                optionMissing: "{scene} 没有给出「{option}」，这条路线走不通",
                otherEnding: "走到的是 {reached}，不是 {ending}",
                endedWithoutEnding: "故事结束了，但没有走到 {ending}",
                stalled: "推进 {steps} 步后停住，没有走到 {ending}",
                cancelled: "推进 {steps} 步后被取消",
                exit: {
                    closed: "游戏在走到 {ending} 之前关闭了",
                    stopped: "游戏在走到 {ending} 之前被停止",
                    crashed: "游戏在走到 {ending} 之前崩溃了",
                    failedToStart: "游戏未能启动",
                },
            },
            summary: {
                passed: "已走到 {ending}",
            },
        },
        routeCoverage: {
            title: "路线覆盖率",
            description: "把条件算进去之后，每个场景、选项和结局是不是真的走得到",
            skipped: {
                noEntryPoint: "没有任何故事标出从哪里开始",
                undecidableEntry: "Start Story 节点在运行时才决定进哪个场景，所以读不出从哪里开始",
                storiesUnread: "有故事读不出来",
            },
            finding: {
                sceneUnreachable: "没有任何路径能满足通往「{scene}」的条件",
                optionUnreachable: "「{option}」永远不会出现——没有路径满足它的条件",
                branchUnreachable: "这条分支永远走不到——没有路径满足它的条件",
                endingUnreachable: "「{name}」写好了，但没有任何路径能满足到达它的条件",
                endingUnreachableUnnamed: "这个结局写好了，但没有任何路径能满足到达它的条件",
            },
            summary: {
                passed: "剧本能通向的东西都走得到",
                failed: "走不到的——场景 {scenes} 个，选项 {options} 个，结局 {endings} 个",
            },
        },
        reachableEndings: {
            title: "结局可达性",
            description: "故事的每一条路径是否都能走到 /ending",
            // 跳过是正常状态：只说工程当前的样子，以及缺的那一样东西，不写成作者做错了什么。
            skipped: {
                noEndings: "有入口的故事都没有写 /ending",
                noEntryPoint: "没有任何故事标出开始的位置",
                undecidableEntry: "Start Story 节点在运行时才决定场景，读不出从哪里开始",
                storiesUnread: "有故事无法读取",
            },
            finding: {
                pathRunsOut: "推进在这里停住，没有到达任何结局",
                optionRunsOut: "「{option}」走到头也没有到达任何结局",
                endingUnreached: "没有路径能到达「{name}」",
                endingUnreachedUnnamed: "没有路径能到达这个结局",
            },
            // 数字放在冒号后面，任何数量都读得通；通过的这次也照样报出没人到得了的结局。
            summary: {
                passed: "每条路径都到达了结局。无人到达的结局：{unreached} / {endings}",
                failed: "走到头的路径：{errors} 条。无人到达的结局：{unreached} / {endings}",
            },
        },
    },
} satisfies LocaleNamespace<"test">;
