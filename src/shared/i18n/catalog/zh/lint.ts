import type { LocaleNamespace } from "../types";

/**
 * `lint` 简体中文。
 *
 * 术语固定：一条检查结果叫「问题」，严重级别是错误／警告／提示；规则标题是短名词短语，
 * 说明是一句话且只出现在提示浮层里，界面上不写解释性句子。
 *
 * **消息里不写它是在哪儿找到的。** 每个显示消息的地方都会在旁边单独给出位置——报告页有自己的
 * 一列，构建控制台走 `nonRedundantLintLocation`——所以「第一天 跳转到了未声明的标签 ending」
 * 把「第一天」说了两遍，而真正区分两条问题的后半句反倒被省略号吃掉。消息是谓语，位置是主语。
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "未使用的资源",
            description: "工程里没有任何地方引用它",
            message: "{asset} 没有被使用",
            messageIndexUnresolved: "未列出未使用的资源：{location} 指向的资源无法确定",
            messageIndexUnreadable: "未列出未使用的资源：{location} 无法读取",
            messageIndexNotBuilt: "未列出未使用的资源：无法扫描本工程",
        },
        assetsMissing: {
            title: "资源缺失",
            description: "引用指向资源库里已不存在的资源",
            message: "{location} 引用了不存在的资源",
        },
        assetsUnreadable: {
            title: "资源无法读取",
            description: "文件无法读取，或者解码失败",
            message: "{asset} 无法解码",
            messageMissingBytes: "{asset} 的文件内容无法读取",
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
            description: "部分已选构建目标不支持的编码",
            message: "{asset} 在 {platform} 上无法播放",
        },
        networkFetchDisallowed: {
            title: "网络节点无法访问网络",
            description: "工程不允许 HTTP，但蓝图里有网络节点",
            message: "{blueprint} 发起了网络请求，本工程不允许",
        },
        storyInvalidCommand: {
            title: "无效指令",
            description: "编译器不接受的行",
            message: "这一行无法编译",
        },
        storyGotoMissing: {
            title: "标签缺失",
            description: "goto 指向场景里没有声明的标签",
            message: "跳转到 {label}，本场景没有声明过它",
        },
        storyLabelDuplicate: {
            title: "标签重复",
            description: "同一标签声明了两次，只有第一次生效",
            message: "{label} 在前面已经声明，此处不会被执行到",
        },
        storyLabelUnused: {
            title: "未使用的标签",
            description: "没有任何跳转指向它",
            message: "没有任何跳转指向 {label}",
        },
        storyJumpMissing: {
            title: "场景缺失",
            description: "跳转指向工程里没有的场景",
            message: "跳转到了故事里已经没有的场景",
        },
        storyEmptyChoice: {
            title: "空选择",
            description: "玩家没有任何可选项的选择",
            message: "这个选择没有任何选项",
            messageEmptyOption: "这个选项没有文字",
        },
        storyDeadEnd: {
            title: "断头路",
            description: "有的路线跳转出去，有的走到底就没了",
            message: "走到这里就掉出场景末尾",
        },
        storyUnreachableScene: {
            title: "到不了的场景",
            description: "从开头出发无法抵达",
            message: "没有任何路径能到达这个场景",
        },
        storyEmptyScene: {
            title: "空场景",
            description: "场景里没有内容",
            message: "这个场景里没有任何行",
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
            message: "{fn}() 在每次判断该条件时都会重新取值，分支结果会在两次判断之间变化；请先用 /set 取值到变量，再判断该变量",
            messageChoiceOption: "{fn}() 在每次绘制菜单时都会重新取值，该选项会闪烁；请先用 /set 取值到变量，再判断该变量",
            messageInterpolation: "{fn}() 在每次绘制该行时都会重新取值，显示的值会不断变化；请先用 /set 取值到变量，再显示该变量",
        },
        textOverlong: {
            title: "行太长",
            description: "超出对话框能放下的宽度",
            message: "宽度 {width}，超过 {max}",
        },
        textEmpty: {
            title: "空行",
            description: "对白行里没有文字",
            message: "这一行没有文字",
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
        brandBrokenLink: {
            title: "断开的颜色链接",
            description: "颜色指向了解析不出结果的配色条目",
            // 这三条和多数规则相反，会在句子里点出自己的出处：这类问题挂在工程上，
            // 旁边那一列位置是空的，{where} 是几十条同类问题之间唯一的区分。
            message: "{where} 用的 {color} 不在配色方案里",
            messageChain: "{where} 用的 {color} 又指向了 {missing}，而配色方案里没有这个颜色",
            messageCycle: "{where} 用的 {color}，它的链接绕回了自己",
        },
    },
    message: {
        ruleFailed: "{rule} 没能运行",
        storyLoadFailed: "{story} 打不开",
    },
    category: {
        assets: "资源",
        portability: "可移植性",
        network: "网络",
        story: "故事",
        variables: "变量",
        text: "文本",
        localization: "本地化",
        voice: "语音",
        // 跟着面板叫，作者要改的就是那个面板，不叫链接协议的名字。
        brand: "配色方案",
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
        filtered: "显示 {shown} / {total}",
        rerun: "重新检查",
        filterAll: "全部",
        groupByRule: "按规则",
        groupByLocation: "按位置",
        collapse: "折叠",
        expand: "展开",
        collapseAll: "全部折叠",
        expandAll: "全部展开",
        // 行号那一列念出来的样子。列里只写数字——故事编辑器的行号槽就是这么写的，
        // 读者是拿这一列去对那一列。
        lineAria: "第 {line} 行",
    },
    command: {
        runProject: "检查工程",
        category: "检查",
    },
    console: {
        started: "开始检查",
        finished: "{errors} 个错误，{warnings} 个警告，用时 {duration}",
        // 先位置、再哪里不对、最后是哪条规则说的——编译器那种一行，也是读的人扫视的顺序。
        // 不再留严重级别的位：控制台每一行左边本来就有一列级别，写在句子里是重复。
        finding: "{location} {message}（{rule}）",
    },
    build: {
        blocked: "{count} 个问题拦下了构建",
        // 逐级写全「面板 → 分页 → 那一行」：这道闸默认开着，没进过这个面板的作者根本不知道
        // 有这么个设置，只说「在检查设置里」等于让人自己去翻。
        blockedHint: "可在「项目 → 检查 → 构建前检查」中修改该行为",
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
