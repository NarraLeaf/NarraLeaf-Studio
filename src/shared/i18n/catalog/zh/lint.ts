import type { LocaleNamespace } from "../types";

/**
 * `lint` 简体中文。
 *
 * 术语固定：一条检查结果叫「问题」，严重级别是错误／警告／提示；规则标题是短名词短语，
 * 说明是一句话且只出现在提示浮层里，界面上不写解释性句子。
 *
 * 语域：陈述当前状态，不解释实现，不与作者对话。指代当前那一行、那个场景一律用「该」，
 * 不用「这个」「这一行」；动词取书面形式（未声明、无法到达、不会执行），不取口语形式
 * （没写、到不了、跑不起来）。标题是名词短语，不是句子，也不是动宾结构。
 *
 * **消息里不写它是在哪儿找到的。** 每个显示消息的地方都会在旁边单独给出位置——报告页有自己的
 * 一列，构建控制台走 `nonRedundantLintLocation`——所以「第一天 跳转到了未声明的标签 ending」
 * 把「第一天」说了两遍，而真正区分两条问题的后半句反倒被省略号吃掉。消息是谓语，位置是主语。
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "未使用的资产",
            description: "工程中没有任何引用指向该资产",
            message: "{asset} 未被任何位置引用",
            messageIndexUnresolved: "未能列出未使用的资产：{location} 指向的资产无法识别",
            messageIndexUnreadable: "未能列出未使用的资产：{location} 无法读取",
            messageIndexNotBuilt: "未能列出未使用的资产：本工程无法扫描",
        },
        assetsMissing: {
            title: "资产缺失",
            description: "引用指向资产库中已不存在的资产",
            message: "{location} 引用了不存在的资产",
        },
        assetsUnreadable: {
            title: "无法读取的资产",
            description: "文件无法读取或解码",
            message: "{asset} 无法解码",
            messageMissingBytes: "{asset} 的文件无法从磁盘读取",
        },
        assetsOversized: {
            title: "过大的文件",
            description: "构建携带的文件超过本工程设定的大小上限",
            // 两个数字都写进句子：这个文件多大，以及工程定的是多少，这样不用打开设置页也能处理。
            message: "{asset} 为 {size}，超过构建可携带的 {limit}",
        },
        assetsGroupIncomplete: {
            title: "未完成的资产集",
            description: "声明的变体中存在未恰好对应一个文件的变体",
            // 变体按组成它的标签写出来，因为把这些标签写到文件上就是解决办法。
            // 不写会解析到的文件名：那个文件还不存在。
            message: "{set} 的 {variant} 没有对应文件",
            messageAmbiguous: "{set} 的 {variant} 对应了 {count} 个文件",
            messageResidency: "{set} 的 {axis} 在运行时解析，却嵌在构建时解析的 {outerAxis} 内",
            messageDeclaration: "{set} 没有声明可解析的变体",
            messageFallback: "{set} 没有指定兜底变体",
        },
        portabilityAssetName: {
            title: "不安全的文件名",
            description: "含有部分文件系统不接受的字符或保留名",
            message: "{asset} 无法在全部平台上写入",
        },
        portabilityCaseCollision: {
            title: "大小写冲突",
            description: "仅大小写不同的名称",
            message: "在不区分大小写的文件系统上，{asset} 与 {other} 冲突",
        },
        portabilityMediaFormat: {
            title: "无法播放的格式",
            description: "部分已选构建目标无法播放的编码",
            message: "{asset} 在 {platform} 上无法播放",
        },
        portabilityVfxAlpha: {
            title: "带透明通道的叠层素材",
            description: "部分已选构建目标不会保留其透明度的叠层素材",
            message: "{asset} 在 {platform} 上将覆盖舞台",
        },
        networkFetchNotAllowlisted: {
            title: "不在白名单内的地址",
            description: "Fetch 节点指向本工程不允许的地址",
            message: "{url} 不在本工程的网络请求白名单内",
        },
        networkFetchDisallowed: {
            title: "无网络许可的网络节点",
            description: "网络策略为不允许联网的工程中存在网络节点",
            message: "{blueprint} 发起网络请求，本工程的网络策略不允许",
        },
        storyInvalidCommand: {
            title: "无效指令",
            description: "编译器不接受的行",
            message: "该行无法编译",
        },
        storyGotoMissing: {
            title: "标签缺失",
            description: "goto 指向场景中未声明的标签",
            message: "跳转目标 {label} 在本场景中未声明",
        },
        storyLabelDuplicate: {
            title: "标签重复",
            description: "同一标签声明两次，仅首次声明可被到达",
            message: "{label} 已在上方声明，此处不会被执行",
        },
        storyLabelUnused: {
            title: "未使用的标签",
            description: "没有任何跳转指向该标签",
            message: "没有任何跳转指向 {label}",
        },
        storyJumpMissing: {
            title: "场景缺失",
            description: "jump 指向工程中不存在的场景",
            message: "跳转目标场景在故事中已不存在",
        },
        storyEmptyChoice: {
            title: "空选择",
            description: "没有任何可供玩家选择的选项",
            message: "该选择没有任何选项",
            messageEmptyOption: "该选项没有文本",
        },
        storyDeadEnd: {
            title: "无子节点",
            description: "场景中部分路径跳转离开，仍有路径的末尾没有子节点",
            message: "该行没有子节点，执行到此处即越过场景末尾",
        },
        storyUnreachableScene: {
            title: "无法到达的场景",
            description: "从起始场景出发无法到达",
            message: "没有任何路径可以到达该场景",
        },
        storyEmptyScene: {
            title: "空场景",
            description: "场景中没有内容",
            message: "该场景没有任何行",
        },
        storyAppTagUnknown: {
            title: "未知的构建变体",
            description: "该行比较的构建变体在工程中不存在",
            message: "工程中没有名为「{name}」的构建变体，该行不会进入任何构建",
        },
        storyCutPointOrphan: {
            title: "没有对应变体的截断点",
            description: "工程中没有构建变体时写下的截断点",
            // 这一行是失效而不是写错，所以句子说的是它现在的状态，而不是作者做了什么。两种处理都写进去，
            // 因为任何一种都是完整的答案。
            message: "本工程没有构建变体，该截断点不会截断任何内容。可新增构建变体，或删除该行",
        },
        storyCutPointUnreachable: {
            title: "无法到达的截断点",
            description: "截断点所在的场景没有任何路径可以到达",
            message: "没有任何路径可以到达该场景，该截断点不会截断任何构建",
        },
        storyStageObjectMissing: {
            title: "不存在的舞台对象",
            description: "该行操作的对象在场景中未被任何行创建",
            message: "场景中没有任何行创建 {object}，该行没有可操作的对象",
            // 角色不是被创建的，是被让它登场的，所以变的只是动词。「登场」是这个词在别处的
            // 一贯说法（`story.enterExit.enter`、`story.empty.emptyExampleShow`、动效的 `entrance`），
            // 同一件事换个说法就是命令词汇那轮消灭掉的东西。
            messageCharacter: "场景中没有任何行让 {object} 登场，该行没有可操作的对象",
        },
        storyDeclaredNeverShown: {
            title: "未显示的舞台对象",
            description: "创建行声明的对象无任何一行显示",
            message: "{object} 在该行声明，无任何一行显示",
        },
        storyStageObjectDuplicate: {
            title: "重复的舞台对象",
            description: "两行创建同一个舞台名称，后一行沿用前一行创建的对象",
            message: "{object} 已在上方创建，该行操作的是已创建的对象",
        },
        storyCharacterMissing: {
            title: "不存在的角色",
            description: "该行指定的角色不在本工程中",
            // 句子里不写出对象：引用解析不到时只剩存下来的 id，而它是一个 UUID，
            // 把 UUID 写进报告等于给作者一个在工程里搜不到的词。
            message: "该行指定的角色不在本工程中",
        },
        storyTransitionUnavailable: {
            title: "转场不可用",
            description: "行中指定的转场，当前版本无法播放",
            // 仍然打印存下来的那个词：菜单里已经找不到它，作者手上只剩这一个抓手。
            message: "转场 {transition} 不可用，该行的画面将直接切换",
        },
        blueprintReferenceMissing: {
            title: "目标缺失",
            description: "节点指向工程中已不存在的对象",
            // 兜底句；每一类都另有自己的句子，因为「对象」正是作者没法据以行动的那个词。
            message: "指向的对象在工程中已不存在",
            messageSurface: "打开的页面已不存在",
            messageStory: "开始的故事已不存在",
            messageScene: "指向的场景已不存在",
            messageChoice: "指向的选项已不存在",
            messageCharacter: "指向的角色已不存在",
            messageTextKey: "指向的文本键在工程中未声明",
        },
        blueprintElementRefMissing: {
            title: "控件缺失",
            description: "节点绑定的控件在工程中已不存在",
            message: "绑定的控件已不存在",
        },
        blueprintFnTargetMissing: {
            title: "函数缺失",
            description: "Call Fn 节点调用的函数在当前作用域中不存在",
            // 兜底句，用于没有签名快照的调用：那时只剩一对 id，
            // 把 id 写进报告等于给作者一个在工程里搜不到的词。
            message: "调用的函数在当前作用域中不存在",
            messageNamed: "调用的 {name} 在当前作用域中不存在",
        },
        blueprintUnreachableNode: {
            title: "无法到达的节点",
            description: "图中没有任何入口可以到达该节点",
            message: "没有任何路径可以到达该节点，它不会被执行",
        },
        blueprintEmptyEvent: {
            title: "空事件",
            description: "事件层中没有连接任何可执行内容",
            message: "该事件不会执行任何内容",
        },
        uiUnlocalizedText: {
            title: "未本地化的文本",
            description: "工程已有第二种语言，文本仍直接写在控件上",
            message: "{text} 未绑定本地化键",
        },
        uiPageUnreachable: {
            title: "无法到达的页面",
            description: "没有任何位置打开或嵌入该页面，它也不是启动页",
            message: "没有任何位置会打开该页面",
        },
        uiEmptyBehavior: {
            title: "未绑定行为的按钮",
            description: "可点击的控件没有任何事件监听",
            message: "点击后不会执行任何内容",
        },
        uiComponentMissing: {
            title: "缺失的组件",
            description: "引用了工程中不存在的组件的实例",
            message: "该实例引用的组件在此工程中不存在",
        },
        uiFrameTargetMissing: {
            title: "缺失的嵌入页面",
            description: "页面控件嵌入了工程中不存在的页面",
            message: "该页面控件嵌入的页面在此工程中不存在",
        },
        blueprintSaveFieldEmpty: {
            title: "未填写的存档字段",
            description: "会执行的 Save Game 节点上，声明过的存档字段未填写",
            message: "{field} 未填写，本次存档将写入其默认值",
        },
        variablesUndeclared: {
            title: "未声明的变量",
            description: "变量在使用前未声明",
            message: "{variable} 已被使用，但从未声明",
        },
        variablesUnused: {
            title: "未使用的变量",
            description: "变量已声明，但从未读取或写入",
            message: "{variable} 已声明，但从未被读取或写入",
        },
        variablesNameCollision: {
            title: "变量重名",
            description: "同一名称在两处声明",
            message: "{variable} 作为持久变量声明了两次",
        },
        variablesRandomOutsideAssignment: {
            title: "赋值之外的随机数",
            description: "随机值位于会被反复重新取值的位置",
            message: "{fn}() 在每次判断该条件时都会重新取值，分支结果会在两次判断之间变化。先用 /set 取值到变量，再判断该变量",
            messageChoiceOption: "{fn}() 在每次绘制菜单时都会重新取值，该选项会闪烁。先用 /set 取值到变量，再判断该变量",
            messageInterpolation: "{fn}() 在每次绘制该行时都会重新取值，显示的值会不断变化。先用 /set 取值到变量，再显示该变量",
        },
        textOverlong: {
            title: "过长的行",
            description: "行宽超过对话框可容纳的宽度",
            message: "宽度 {width}，超过上限 {max}",
        },
        textEmpty: {
            title: "空行",
            description: "对白行中没有文本",
            message: "该行没有文本",
        },
        localizationMissing: {
            title: "缺少翻译",
            description: "目标语言中没有该行的译文",
            message: "缺少 {locale} 译文",
        },
        localizationStale: {
            title: "译文过期",
            description: "原文在翻译之后发生过修改",
            message: "{locale} 译文比原文旧",
        },
        localizationOrphan: {
            title: "孤立的译文",
            description: "对应的原文已不存在",
            message: "{count} 条 {locale} 译文没有对应的行",
        },
        voiceMissing: {
            title: "缺少语音",
            description: "配音语言中没有该行的录音",
            message: "缺少 {locale} 录音",
        },
        voiceStale: {
            title: "语音过期",
            description: "台词在录音之后发生过修改",
            message: "{locale} 录音比台词旧",
        },
        voiceOrphan: {
            title: "孤立的语音",
            description: "对应的台词已不存在",
            message: "{count} 条 {locale} 录音没有对应的行",
        },
        brandBrokenLink: {
            title: "断开的颜色链接",
            description: "颜色指向无法解析的配色条目",
            // 这三条和多数规则相反，会在句子里点出自己的出处：这类问题挂在工程上，
            // 旁边那一列位置是空的，{where} 是几十条同类问题之间唯一的区分。
            message: "{where} 使用的 {color} 不在配色方案中",
            messageChain: "{where} 使用的 {color} 指向 {missing}，配色方案中没有该颜色",
            messageCycle: "{where} 使用的 {color}，其链接指回自身",
        },
    },
    message: {
        ruleFailed: "{rule} 未能运行",
        storyLoadFailed: "{story} 无法打开",
    },
    category: {
        assets: "资产",
        portability: "可移植性",
        network: "网络",
        story: "故事",
        blueprint: "蓝图",
        // 跟着作者看得见的词叫：这一类说的是页面和页面上的控件，不叫内部的「Surface」。
        ui: "页面",
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
        empty: "未发现问题",
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
        blocked: "{count} 个问题中止了构建",
        // 逐级写全「面板 → 分页 → 那一行」：这道闸默认开着，没进过这个面板的作者根本不知道
        // 有这么个设置，只说「在检查设置里」等于让人自己去翻。
        blockedHint: "可在「项目 ▸ 工程 ▸ 构建前检查」中调整",
        skipped: "已跳过工程检查",
    },
    settings: {
        runOnBuild: "构建前检查",
        runOnBuildHint: "将工程检查纳入正式构建",
        failBuildOn: "中止构建的级别",
        failBuildOnError: "错误",
        failBuildOnWarning: "警告及错误",
        optionMaxChars: "最大宽度",
        optionCountMode: "计数方式",
        countModeEastAsianWidth: "宽字符计 2 列",
        countModeCodePoints: "所有字符计 1 列",
    },
} satisfies LocaleNamespace<"lint">;
