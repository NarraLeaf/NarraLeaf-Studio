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
        empty: "无结果",
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
                passed: "未发现问题",
                failed: "{errors} 个错误，{warnings} 个警告",
            },
        },
        walkthrough: {
            title: "结局通关",
            description: "从故事的入口场景开始运行游戏，直至到达指定结局",
            parameter: {
                ending: {
                    label: "结局",
                    description: "需要到达的结局",
                    option: "{story} / {scene} / {ending}",
                    unnamed: "未命名结局",
                },
            },
            log: {
                planned: "已规划路线：{scenes} 个场景，{decisions} 处选择",
                choosing: "{scene}：选择「{option}」",
                improvised: "以「{option}」应答了路线之外的选择",
            },
            finding: {
                endingMissing: "该结局已不在故事中",
                noEntryPoint: "未指定《{story}》的起始场景",
                unreachable: "从《{story}》的起点无法到达 {ending}",
                optionMissing: "{scene} 未提供「{option}」，该路线无法通行",
                otherEnding: "到达的是 {reached}，而非 {ending}",
                endedWithoutEnding: "故事已结束，未到达 {ending}",
                stalled: "推进 {steps} 步后停止，未到达 {ending}",
                cancelled: "推进 {steps} 步后取消",
                exit: {
                    closed: "游戏在到达 {ending} 前关闭",
                    stopped: "游戏在到达 {ending} 前被停止",
                    crashed: "游戏在到达 {ending} 前崩溃",
                    failedToStart: "游戏未能启动",
                },
            },
            summary: {
                passed: "已到达 {ending}",
            },
        },
        routeCoverage: {
            title: "路线覆盖",
            description: "在条件求值后，各场景、选项与结局是否可以到达",
            skipped: {
                noEntryPoint: "没有故事标明起始位置",
                undecidableEntry: "Start Story 节点在运行时才决定场景，无法读出起始位置",
                storiesUnread: "有故事无法读取",
            },
            finding: {
                sceneUnreachable: "没有路径能满足通往「{scene}」的条件",
                optionUnreachable: "没有路径能满足提供「{option}」的条件",
                branchUnreachable: "没有路径能满足进入该分支的条件",
                endingUnreachable: "「{name}」已写入，但没有路径能满足到达它的条件",
                endingUnreachableUnnamed: "该结局已写入，但没有路径能满足到达它的条件",
            },
            summary: {
                passed: "剧本指向的场景、选项与结局均可到达",
                failed: "无法到达：场景 {scenes} 个，选项 {options} 个，结局 {endings} 个",
            },
        },
        reachableEndings: {
            title: "结局可达性",
            description: "故事的每条路径是否都能到达 /ending",
            // 跳过是正常状态：只说工程当前的样子，以及缺的那一样东西，不写成作者做错了什么。
            skipped: {
                noEndings: "有入口的故事均未写入 /ending",
                noEntryPoint: "没有故事标明起始位置",
                undecidableEntry: "Start Story 节点在运行时才决定场景，无法读出起始位置",
                storiesUnread: "有故事无法读取",
            },
            finding: {
                pathRunsOut: "推进在此停止，未到达任何结局",
                optionRunsOut: "「{option}」推进至末尾，未到达任何结局",
                endingUnreached: "没有路径能到达「{name}」",
                endingUnreachedUnnamed: "没有路径能到达该结局",
            },
            // 数字放在冒号后面，任何数量都读得通；通过的这次也照样报出没人到得了的结局。
            summary: {
                passed: "每条路径均到达结局。未到达的结局：{unreached} / {endings}",
                failed: "未到达结局的路径：{errors} 条。未到达的结局：{unreached} / {endings}",
            },
        },
    },
} satisfies LocaleNamespace<"test">;
