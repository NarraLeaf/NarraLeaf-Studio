import type { LocaleNamespace } from "../types";

/**
 * `lint` 简体中文。
 *
 * 术语固定：一条检查结果叫「问题」，严重级别是错误／警告／提示；规则标题是短名词短语，
 * 说明是一句话且只出现在提示浮层里，界面上不写解释性句子。
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "未使用的资源",
            description: "工程里没有任何地方引用它",
            message: "{asset} 没有被使用",
        },
        assetsMissing: {
            title: "资源缺失",
            description: "引用指向资源库里已不存在的资源",
            message: "{location} 引用了不存在的资源",
        },
        assetsUnreadable: {
            title: "资源无法读取",
            description: "文件读不出来，或者解码失败",
            message: "{asset} 无法解码",
            messageMissingBytes: "{asset} 读不出文件内容",
        },
        portabilityAssetName: {
            title: "文件名不安全",
            description: "含有部分文件系统不接受的字符或保留名",
            message: "{asset} 在部分平台上写不出来",
        },
        portabilityCaseCollision: {
            title: "大小写冲突",
            description: "只有大小写不同的名字",
            message: "在不区分大小写的文件系统上，{asset} 与 {other} 冲突",
        },
        portabilityMediaFormat: {
            title: "格式不受支持",
            description: "部分已选构建目标放不了的编码",
            message: "{asset} 在 {platform} 上无法播放",
        },
        storyInvalidCommand: {
            title: "无效指令",
            description: "编译器不接受的行",
            message: "{scene} 里有无效指令",
        },
        storyGotoMissing: {
            title: "标签缺失",
            description: "goto 指向场景里没有声明的标签",
            message: "{scene} 跳转到了未声明的标签 {label}",
        },
        storyLabelDuplicate: {
            title: "标签重复",
            description: "同一标签声明了两次，只有第一次生效",
            message: "{scene} 里 {label} 被声明了多次",
        },
        storyLabelUnused: {
            title: "未使用的标签",
            description: "没有任何跳转指向它",
            message: "{scene} 里的 {label} 从未被用到",
        },
        storyJumpMissing: {
            title: "场景缺失",
            description: "跳转指向工程里没有的场景",
            message: "{scene} 跳转到了不存在的场景",
        },
        storyEmptyChoice: {
            title: "空选择",
            description: "玩家没有任何可选项的选择",
            message: "{scene} 里有一个没有选项的选择",
            messageEmptyOption: "{scene} 里有一个没有文字的选项",
        },
        storyDeadEnd: {
            title: "断头路",
            description: "有的路线跳转出去，有的走到底就没了",
            message: "{scene} 走到底就没了",
        },
        storyUnreachableScene: {
            title: "到不了的场景",
            description: "从开头出发无法抵达",
            message: "{scene} 无法抵达",
        },
        storyEmptyScene: {
            title: "空场景",
            description: "场景里没有内容",
            message: "{scene} 是空的",
        },
        variablesUndeclared: {
            title: "未声明的变量",
            description: "用到了却没有声明",
            message: "{variable} 被使用，但从未声明",
        },
        variablesUnused: {
            title: "未使用的变量",
            description: "声明了但从不读也不写",
            message: "{variable} 已声明，但从未用到",
        },
        variablesNameCollision: {
            title: "变量重名",
            description: "同一个名字在两处声明",
            message: "{variable} 被声明了两个不同的持久变量",
        },
        variablesRandomOutsideAssignment: {
            title: "赋值之外的随机数",
            description: "随机值出现在会被反复重算的位置",
            message: "{fn}() 每次判断这个条件都会重掷一次，分支会自己变。先用 /set 掷进一个变量，再判断那个变量",
            messageChoiceOption: "{fn}() 每次绘制菜单都会重掷一次，这个选项会闪。先用 /set 掷进一个变量，再判断那个变量",
            messageInterpolation: "{fn}() 每次绘制这一行都会重掷一次，显示的值会一直变。先用 /set 掷进一个变量，再显示那个变量",
        },
        textOverlong: {
            title: "行太长",
            description: "超出对话框能放下的宽度",
            message: "宽度 {width}，超过 {max}",
        },
        textEmpty: {
            title: "空行",
            description: "对话行里没有文字",
            message: "{scene} 里有一行没有文字",
        },
        localizationMissing: {
            title: "缺少翻译",
            description: "目标语言里没有这一行的译文",
            message: "缺少 {locale} 译文",
        },
        localizationStale: {
            title: "译文过期",
            description: "原文在翻译之后又改过",
            message: "{locale} 译文比原文旧",
        },
        localizationOrphan: {
            title: "多余的译文",
            description: "对应的原文已经不存在",
            message: "{count} 条 {locale} 译文找不到对应的行",
        },
        voiceMissing: {
            title: "缺少语音",
            description: "配音语言里没有这一行的录音",
            message: "缺少 {locale} 录音",
        },
        voiceStale: {
            title: "语音过期",
            description: "台词在录音之后又改过",
            message: "{locale} 录音比台词旧",
        },
        voiceOrphan: {
            title: "多余的语音",
            description: "对应的台词已经不存在",
            message: "{count} 条 {locale} 录音找不到对应的行",
        },
    },
    message: {
        ruleFailed: "{rule} 没能运行",
        storyLoadFailed: "{story} 打不开",
    },
    category: {
        assets: "资源",
        portability: "可移植性",
        story: "故事",
        variables: "变量",
        text: "文本",
        localization: "本地化",
        voice: "语音",
    },
    severity: {
        error: "错误",
        warning: "警告",
        info: "提示",
        off: "关闭",
    },
    report: {
        title: "问题",
        empty: "没有发现问题",
        running: "检查中…",
        summary: "{errors} 个错误，{warnings} 个警告，{infos} 个提示",
        rerun: "重新检查",
        filterAll: "全部",
        groupByRule: "按规则",
        groupByLocation: "按位置",
    },
    command: {
        runProject: "检查工程",
        category: "检查",
    },
    console: {
        started: "开始检查",
        finished: "{errors} 个错误，{warnings} 个警告，用时 {duration}",
        finding: "{severity} {rule} {location} {message}",
    },
    build: {
        blocked: "{count} 个问题拦下了构建",
        // 逐级写全「面板 → 分页 → 那一行」：这道闸默认开着，没进过这个面板的作者根本不知道
        // 有这么个设置，只说「在检查设置里」等于让人自己去翻。
        blockedHint: "可以在 项目 → 检查 → 构建前检查 里改掉这个行为",
        skipped: "已跳过工程检查",
    },
    settings: {
        runOnBuild: "构建前检查",
        runOnBuildHint: "把工程检查纳入正式构建",
        failBuildOn: "拦下构建的级别",
        failBuildOnError: "错误",
        failBuildOnWarning: "警告及错误",
        optionMaxChars: "最大宽度",
        optionCountMode: "计数方式",
        countModeEastAsianWidth: "宽字符算两格",
        countModeCodePoints: "每个字符算一格",
    },
} satisfies LocaleNamespace<"lint">;
