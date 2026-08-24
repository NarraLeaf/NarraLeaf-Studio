import type { LocaleNamespace } from "../types";

/**
 * 版本之间的文档差异怎么念。
 *
 * `document.` / `opaque.` / `summary.` / `structural.` 四组键由**主进程**的差异产出方发出
 * （`vcs/diff/documentDiff.ts` 与 `shared/documents/jsonStructuralDiff.ts`），它交出的是
 * 「翻译键 + 参数」而不是句子。改键名必须两边同时改，否则标签会静默退化成键名本身。
 *
 * 模板里**没有值**：`from` / `to` 是作者自己的数据，界面把它们画成「旧 → 新」一对，
 * 而不是塞进一句话里——这样 320px 的轨道截断的是值而不是句子。
 */
export const documentDiff = {
    document: {
        added: "新增（{bytes}）",
        removed: "删除（{bytes}）",
    },
    opaque: {
        changed: "已改动（{fromBytes} → {toBytes}）",
        unread: "已改动，未查看内容",
    },
    /**
     * 资产：不读内容，只读文件头。
     *
     * 由 `vcs/diff/contentDiff.ts` 发出。每一行都是有条件的：把时长写在文件末尾的容器报不出时长，
     * 名称表落在前缀之外的字体报不出字族。
     *
     * `changed` / `notInspected` / `unrecognized` 是三件不同的事，必须保持三句话：第一句是文件头
     * 读到了、数值相同；第二句是这次比较没有花这些字节；第三句是 Studio 对这个格式永远说不出更多。
     */
    content: {
        size: "大小（{fromBytes} → {toBytes}）",
        dimensions: "尺寸（{fromWidth}×{fromHeight} → {toWidth}×{toHeight}）",
        duration: "时长（{fromSeconds} 秒 → {toSeconds} 秒）",
        sampleRate: "采样率（{fromHertz} Hz → {toHertz} Hz）",
        family: "字族（{from} → {to}）",
        changed: "内容已改动",
        notInspected: "内容已改动，未读取文件头。",
        unrecognized: "内容已改动。Studio 无法识别此格式。",
        moved: "自 {from} 移动而来",
    },
    summary: {
        title: "名称",
        count: "{name}",
        other: "总数之外有改动",
    },
    structural: {
        property: "{name}",
        element: "第 {index} 项",
        root: "文档本身",
    },
    count: {
        appTags: "变体",
        dlc: "DLC",

        assetSets: "资产集",
        assets: "资产",
        audioTracks: "音轨",
        brandColors: "配色",
        brandFonts: "默认字体",
        characterGroups: "角色分组",
        characters: "角色",
        dictionaryTerms: "词典词条",
        localizationKeys: "本地化键",
        projectLanguages: "语言",
        projectPlugins: "插件",
        saveFields: "存档字段",
        storyBlocks: "故事行",
        storyChapters: "章节",
        storyScenes: "场景",
        translationUnits: "译文",
        uiBlueprints: "蓝图",
        uiComponents: "组件",
        uiElements: "界面元素",
        uiGraphNodes: "蓝图节点",
        uiSurfaces: "界面",
        variables: "变量",
        voiceUnits: "语音",
    },
    story: {
        renamed: "故事改名",
        documentField: "{field} 改动",
        chapterAdded: "新增章节",
        chapterRemoved: "删除章节",
        chapterRenamed: "章节改名",
        chapterScenes: "场景列表改动",
        chapterOrder: "章节顺序调整",
        sceneAdded: "新增场景（{blocks} 行）",
        sceneRemoved: "删除场景（{blocks} 行）",
        sceneChanged: "场景改动",
        sceneRenamed: "改名",
        sceneField: "场景 {field}",
        blockAdded: "新增故事行",
        blockRemoved: "删除故事行",
        blockChanged: "行内容改动",
        blockMoved: "行的位置发生变化",
        blockKind: "行类型改变",
        blockDisabled: "行已停用",
        blockEnabled: "行已启用",
        blockField: "{field} 改动",
        blockOrder: "行顺序调整",
    },
    characters: {
        castOrder: "角色顺序调整（共 {count} 位）",
        added: "新增角色",
        removed: "删除角色",
        changed: "角色改动",
        renamed: "改名",
        profileField: "资料 {field}",
        kindChanged: "外观类型改变",
        poseAdded: "新增姿态",
        poseRemoved: "删除姿态",
        poseRenamed: "姿态改名",
        poseAsset: "更换了图片",
        poseChanged: "姿态改动",
        poseOrder: "姿态顺序调整",
        defaultPose: "默认姿态改变",
        axisAdded: "新增差分轴",
        axisRemoved: "删除差分轴",
        axisChanged: "差分轴改动",
        layerAdded: "新增图层",
        layerRemoved: "删除图层",
        layerChanged: "图层改动",
        layerAsset: "更换了图片",
        layerOptionAsset: "图层用图",
        layerOrder: "图层顺序调整",
        appearanceField: "外观 {field}",
        avatarChanged: "对白头像 {key}",
        groupAdded: "新增分组",
        groupRemoved: "删除分组",
        groupRenamed: "分组改名",
    },
    /** 只有 merge3 会用到；这个格式还没有语义 diff，行旁边也不放 subject（单元 id 不是作者写的字）。 */
    localization: {
        added: "新增译文",
        removed: "删除译文",
        changed: "译文改动",
    },
    /**
     * 界面文档：界面与界面上的元素。
     *
     * 作者自己写的字（界面名、元素名）由 subject 带，画在这些标签旁边，所以这里不再重复它。
     * `element*` 那几条是碎句：它们挂在「元素改动」下面，只说这个元素的哪一部分变了。
     */
    uiDocument: {
        renamed: "界面文档改名",
        surfaceAdded: "新增界面（{elements} 个元素）",
        surfaceRemoved: "删除界面（{elements} 个元素）",
        surfaceChanged: "界面改动",
        surfaceRenamed: "改名",
        /** 界面排版所用的设计区域，不是渲染分辨率。 */
        surfaceDesignSize: "设计尺寸（{fromWidth}×{fromHeight} → {toWidth}×{toHeight}）",
        surfaceSettings: "背景或页面动画改动",
        surfaceRoot: "根元素改变",
        surfaceField: "{field} 改动",
        componentAdded: "新增组件（{elements} 个元素）",
        componentRemoved: "删除组件（{elements} 个元素）",
        componentChanged: "组件改动",
        componentRenamed: "改名",
        componentField: "{field} 改动",
        elementAdded: "新增元素",
        elementRemoved: "删除元素",
        elementChanged: "元素改动",
        elementRenamed: "改名",
        /** 换了控件类型，比如文本变成按钮；两个类型 id 画成「旧 → 新」一对。 */
        elementType: "元素类型改变",
        /** 换了父级，不是同级重排——重排是 elementOrder 那条。 */
        elementMoved: "移到了别的父级下",
        elementOrder: "子元素顺序调整",
        elementLayout: "位置或尺寸改动",
        elementStyle: "样式改动",
        elementProps: "内容改动",
        elementBehavior: "行为改动",
        elementBinding: "绑定改动",
        elementAnimation: "动画改动",
        elementField: "{field} 改动",
    },
    /**
     * 蓝图文档：界面背后的逻辑。
     *
     * `nodeMoved` 是这一层的形状所围绕的那一条。拖动节点不改变玩家看到的任何东西，用跟改参数
     * 一样的话去说它，就等于把「顺手理了理版面」抬到跟「改了游戏行为」同一级。所以它自成一行、
     * 自带一个标记。
     *
     * 这里没有任何一条给节点起名字：节点类型是 `blueprint.event.head.appBoot` 这样的标识符，
     * 它的人类名字来自编辑器自己的一张表，把标识符摆在作者面前会被读成作者自己写的字。
     */
    uiGraphs: {
        /** 一个宿主槽位当前生效的是哪个蓝图。 */
        ownerRecord: "生效蓝图改变",
        blueprintAdded: "新增蓝图（{nodes} 个节点）",
        blueprintRemoved: "删除蓝图（{nodes} 个节点）",
        blueprintChanged: "蓝图改动",
        blueprintRenamed: "改名",
        /** TypeScript 蓝图，整个程序就是一份代码。 */
        blueprintSource: "代码改动",
        blueprintField: "{field} 改动",
        graphAdded: "新增图（{nodes} 个节点）",
        graphRemoved: "删除图（{nodes} 个节点）",
        graphChanged: "图改动",
        graphRenamed: "改名",
        graphField: "{field} 改动",
        graphOrder: "图的顺序调整",
        nodeAdded: "新增节点",
        nodeRemoved: "删除节点",
        nodeChanged: "节点改动",
        nodeParams: "取值改动",
        /** 在画布上拖动过。说得平直，是为了让它同样容易被略过。 */
        nodeMoved: "在画布上移动",
        nodeType: "节点类型改变",
        nodeField: "{field} 改动",
        edgeAdded: "新增连线",
        edgeRemoved: "删除连线",
    },
    assets: {
        added: "新增资产",
        removed: "删除资产",
        changed: "资产改动",
        renamed: "改名",
        content: "文件内容已替换",
        field: "{field} 改动",
        /** 资产内容文件，本次对比里没有任何资产记录指向它。文件名是 id 的分片，说不出别的。 */
        orphanContent: "没有对应资产记录的文件",
    },
    /**
     * 工程配色。
     *
     * subject 是作者给这个颜色起的名字；内置的那十七条没有名字——它们的名字是面板给的翻译串，
     * 所以这类行只带两个颜色值，底下由 `BrandChangeDetail` 画出整份配色。
     */
    brand: {
        added: "新增配色",
        removed: "删除配色",
        renamed: "改名",
        /** 一对值就是两个颜色，画成两块色块而不是当文字读。 */
        value: "颜色改动",
        /** 默认字体栈。整份列表只出一行：每一级存的是资产 id。 */
        fonts: "默认字体改动",
    },
    /**
     * 构建变体：同一个工程出货的几个版本。
     *
     * 除开头三条，下面每一条都只报字段名，不说「改动」——这是八条能共用的唯一一种写法。
     * 其中四条是变体面板本来就用的长名字（「剧本结束后显示的页面」），另外四条各用两遍：
     * 挂在某个变体下面时由 subject 点名，单独出现时说的是每个变体都继承的那份工程取值。
     * 发生了什么，行上已经有了：标记，以及旁边那一对值。
     *
     * `version` 说明这是谁的版本。这个界面本身满是版本号（#3、#7），
     * 不加限定的「版本」会被读成其中之一。
     */
    appTags: {
        added: "新增变体",
        removed: "删除变体",
        renamed: "改名",
        /** 三个身份字段。某一侧没有值，就是这个变体在继承工程的取值。 */
        displayName: "应用名称",
        identifier: "标识符",
        version: "项目版本",
        plugins: "插件设置",
        assetAxes: "构建使用的资产",
        scenes: "可以开始的场景",
        ending: "剧本结束后显示的页面",
        order: "变体顺序",
    },
    /**
     * 工程的调音台。
     *
     * `rerouted` 是这一层存在的理由。一条总线汇入哪里，决定它的音量跟谁相乘、玩家的哪一根滑杆
     * 管得到它，而这件事不改变任何计数——所以在概要那一层，改过路由的文件只能说「变了，但概要
     * 说不出变在哪」。一对值是两条总线的名字；直接挂到主输出的那种情况没有父级可以点名，
     * 所以它自成一条，而不是只填半对值。
     */
    audioTracks: {
        added: "新增音轨",
        removed: "删除音轨",
        renamed: "改名",
        rerouted: "改为汇入别的总线",
        reroutedToMaster: "改为直接汇入主输出",
        /** 一对值是滑杆自己的数字（百分数），不是存下来的 0 到 1。 */
        volume: "音量改动",
        /** 说的是现在的默认行为，因为 `true` / `false` 是文件的说法，不是作者的。 */
        loopOn: "默认循环播放",
        loopOff: "默认只播放一次",
        order: "音轨顺序调整",
    },
    /**
     * 工程的存档变量与全局变量。
     *
     * `defaultValue` 是这一层存在的理由：它是每一周目的起点，也是变量出现之前写下的存档读出来的值，
     * 改动它就改动了出货的游戏，而计数一动不动。作用域那两条说的是这个变量现在是什么，
     * 而不是把两个存储用词摆成一对——其中 persistent 那个词，面板里根本不这么叫。
     */
    variables: {
        added: "新增变量",
        removed: "删除变量",
        renamed: "改名",
        defaultValue: "默认值改动",
        valueType: "类型改动",
        scopeSaved: "现在是存档变量",
        scopeGlobal: "现在是全局变量",
        /** 值存在哪个键下。改名本来就设计成永远不动它。 */
        storageKey: "已经存下的值从此读不回来",
        description: "备注改动",
    },
    /**
     * 一个存档槽位除引擎自身记录之外还带的字段。
     *
     * `removed` 是这里唯一一条把代价说出口的，也是唯一一条需要说的。加字段天生是安全的——
     * 槽位里没有这个值就读默认值；删字段则把读它的针脚一并拿掉，玩家硬盘上已有的每一个存档
     * 从此攥着一个工程里再也没人问得出来的值。
     */
    saveSchema: {
        added: "新增存档字段",
        removed: "删除存档字段。已有存档里的值还在，但没有地方读它",
        renamed: "改名",
        valueType: "类型改动",
        defaultValue: "默认值改动",
        /** 存档内部的键，创建时定下，正是为了让改名不会让已写入的值失去归属。 */
        storageKey: "已经存下的值从此读不回来",
        description: "备注改动",
        /** 它在存档节点针脚里的位置。游戏本身什么都没变。 */
        reordered: "在字段中的位置改变",
    },
    /**
     * 工程自己的词汇表。
     *
     * 这里没有「改名」，也不可能有：词条没有 id，写法本身就是身份，所以改写法读作一条没了、
     * 另一条来了。两条选项说的是词典现在做什么——它们改变故事编辑器在工程里每一份剧本上标出的东西。
     */
    dictionary: {
        added: "新增词条",
        removed: "删除词条",
        reading: "读音改动",
        /** 一个列表，所以不摆一对值：两串异体写法挤在一行，多宽都读不了。 */
        variants: "异体写法改动",
        note: "备注改动",
        readingsOn: "现在会建议读音",
        readingsOff: "现在不再建议读音",
        variantsOn: "现在会检查异体写法",
        variantsOff: "现在不再检查异体写法",
    },
    /**
     * 第一档，项目自身的设置——游戏叫什么，以及构建、存档和玩家第一次启动时读到的一切。
     *
     * 项目的每个区域一行，区域里每项设置一条子行，因为作者就是这样接触它们的：这些值散落在十四个面板里，
     * 作者认得的是面板上的说法，不是文件里的字段名。两侧的值摆在行上，所以策略和模式仍按文件里的原词引用。
     *
     * `field` 是最后手段，有五个区域完全落在它上面——签名凭据、分发密钥，以及构建、补丁和检查三个对话框
     * 记住的上次选择。其中四个只是对话框的记忆，一个是没人手写的密钥；给它们的字段编一套作者文案，
     * 等于宣称存在一个并不存在的面板。
     */
    project: {
        name: "应用名称",
        identifier: "标识符",
        /** 这个版本没有对应说法的设置，按文件里的原名列出。 */
        field: "{field} 改动",
        metadata: "详情",
        metaVersion: "项目版本",
        metaDescription: "简介",
        metaAuthor: "作者",
        metaEmail: "联系邮箱",
        metaWebsite: "网站",
        /** 一行字，写进打包出来的可执行文件属性里。 */
        metaCopyright: "版权",
        /** 完整声明，随游戏一起发出去。 */
        metaCopyrightText: "版权声明",
        metaResolution: "窗口尺寸",
        metaIcons: "图标",
        network: "网络访问",
        networkPolicy: "网络策略",
        networkAllowlist: "网络请求白名单",
        networkHttp: "明文 HTTP 请求",
        networkRemoteResource: "远程资源",
        networkRemoteScript: "远程脚本",
        localization: "语言",
        sourceLocale: "源语言",
        locales: "语言列表",
        voice: "语音",
        voicedLocales: "有语音的语言",
        voiceNaming: "语音文件命名",
        voiceCast: "语音分配",
        voiceChoices: "选项语音",
        dialogue: "对话",
        dialogueAutoForwardPause: "自动前进时的停顿时长",
        preferences: "玩家默认设置",
        prefTextSpeed: "文字速度",
        prefGameSpeed: "游戏速度",
        prefAutoForward: "自动前进",
        prefAutoForwardDelay: "自动前进等待时间",
        prefShowDialog: "显示对话框",
        prefSkip: "允许跳过",
        prefSkipReadText: "跳过已读文本",
        prefSkipDelay: "跳过延迟",
        prefSkipInterval: "跳过间隔",
        prefGlobalVolume: "总音量",
        prefBgmVolume: "音乐音量",
        prefSoundVolume: "音效音量",
        prefVoiceVolume: "语音音量",
        prefVoiceEndMode: "语音随句子结束时",
        prefVoiceFadeDuration: "语音淡出时长",
        autoSave: "存档",
        autoSaveEnabled: "自动保存",
        autoSaveInterval: "保存间隔",
        autoSaveSlots: "保留数量",
        saveCompatibility: "旧存档",
        saveCompatible: "其他项目版本的存档",
        saveIncompatible: "故事变更前的存档",
        saveLocation: "玩家文件",
        saveLocationWindowsLinux: "Windows 与 Linux",
        saveLocationMacos: "macOS",
        languageChange: "语言切换",
        languageChangeInGame: "游戏进行中切换语言",
        security: "安全",
        encryptAssets: "加密资产",
        crash: "崩溃",
        crashPolicy: "游戏停止工作时",
        assetOptimization: "优化",
        lossyImages: "重压缩图像",
        lossyQuality: "图片质量",
        vfx: "画面特效",
        vfxFrameRate: "天气帧率",
        mobile: "移动端",
        mobileOrientation: "屏幕方向",
        mobileFit: "屏幕适配",
        mobileCropX: "水平保留",
        mobileCropY: "垂直保留",
        distribution: "分发密钥",
        signing: "签名",
        build: "构建设置",
        patch: "补丁导出设置",
        linting: "工程检查",
        dependencies: "依赖",
        dependencyPlugins: "插件列表",
    },
    tier: {
        summary: "仅概要",
        summaryHint: "只比较了总数，没有比较内容本身",
        structural: "结构级",
        structuralHint: "这份列表里可能有并非改动的差异",
        content: "仅格式信息",
        contentHint: "比较的是文件自述的信息，没有比较内容本身",
        opaque: "未读取",
        opaqueHint: "只比较了文件体积",
    },
    rows: {
        loading: "正在读取差异…",
        empty: "该文件内部没有差异",
        // 三种「空」。「已修改」配上「没有差异」读起来是自相矛盾，而每一档能给出的
        // 说法强度不一样，理由见 documentDiffEmptyKey。
        emptyFormatting: "只有格式变了",
        emptyUntracked: "编辑器中没有可见的变化",
        emptyCounts: "总数没有变化",
        moreInGroup: "另有 {count} 处",
        showing: "已显示 {shown} / {total}",
    },
    rail: {
        compareWithPrevious: "与上一个版本对比",
    },
    /** 某一种格式自己的详情面板所加的词（`renderer/lib/vcs/presenters`）。变更本身怎么读仍在上面的分档键里。 */
    presenter: {
        /** 两个版本的称呼，所有格式共用一份，避免同一个词在一次对比里出现两种写法。 */
        before: "更改前",
        after: "更改后",
        image: {
            modeLabel: "对比方式",
            sideBySide: "并排",
            swipe: "滑动分割",
            difference: "差异",
            splitPosition: "分割位置",
            /** 差异模式要求两边像素一一对应，尺寸不同就无从相减。 */
            sizeDiffers: "两个版本尺寸不同，无法逐像素比较",
            /** 画面位置上可能出现的四种状态，各自是不同的事实，不合并成一句。 */
            tooLarge: "该文件过大，无法在此显示",
            unsupported: "该图片格式无法在此显示",
            unreadable: "该图片无法读取",
        },
        audio: {
            play: "播放",
            pause: "暂停",
            /** 解码后得到的声道数。 */
            mono: "单声道",
            stereo: "立体声",
            channels: "{count} 声道",
            /**
             * 波形位置上可能出现的四种状态。
             *
             * `tooLarge` 说的是文件，它从未被读取；`tooLong` 说的是声音本身：字节已经在手上，
             * 解码它要占用的内存超出预览允许的额度，所以下方的数字照常给出，只是不画波形。
             */
            tooLarge: "该文件过大，无法在此播放",
            tooLong: "该音轨过长，无法在此预览",
            unreadable: "该音频无法读取",
        },
        font: {
            sizeLabel: "字号",
            /** 样张同时含中英文：只看拉丁字母看不出中文字形是否随字体一起装上。 */
            sample: "The quick brown fox 0123 汉字排版样张",
            unreadable: "该字体无法加载",
            tooLarge: "该文件过大，无法在此显示",
        },
        brand: {
            added: "新增",
            removed: "删除",
            unreadable: "该调色板无法读取",
            tooLarge: "该文件过大，无法在此显示",
            unchangedOne: "另有 1 个颜色未变",
            unchangedMany: "另有 {count} 个颜色未变",
            /** 指向本调色板另一个条目、但最终没有落到颜色上的值：名字不存在，或者成环。 */
            unresolved: "无颜色",
        },
    },
    /** 变更文件的分组标题，用作者编辑它们的面板名，而不是它们在磁盘上的目录名。 */
    category: {
        story: "故事",
        characters: "角色",
        interface: "界面",
        assets: "资产",
        localization: "本地化",
        audio: "音频",
        settings: "项目",
        other: "其他",
    },
    /** 对比的两栏：左边是变更文件索引，右边是其中一个文件的改动。 */
    shell: {
        fileList: "变更文件",
        resize: "调整文件列表宽度",
        selectPrompt: "展开一个分组并选中文件，查看其中的改动",
        changes: {
            one: "{count} 处改动",
            other: "{count} 处改动",
        },
        fileAdded: "新增",
        fileRemoved: "删除",
        fileMoved: "移动",
        /** 一份文档由多个文件组成时，在行的悬浮提示里说一次。 */
        setFiles: {
            one: "本文档有 {count} 个文件发生改动",
            other: "本文档有 {count} 个文件发生改动",
        },
        /** 每组只说一次，不逐行重复；具体是哪一种，写在该文件自己的详情里。 */
        partial: {
            one: "本组有 {count} 个文件可能存在未列出的改动",
            other: "本组有 {count} 个文件可能存在未列出的改动",
        },
    },
    tab: {
        workingTree: "改动",
        between: "{from} → {to}",
        comparingWorkingTree: "当前工程与 {version} 对比",
        comparingWorkingTreeUnknown: "当前工程与上一个版本对比",
        comparingRevisions: "{from} 与 {to} 对比",
        refresh: "重新读取",
        empty: "两个版本之间没有差异",
        emptyWorkingTree: "自上一个版本以来没有改动",
        readFailure: "无法读取本次对比：{error}",
        incomplete: "{total} 份变更文档中比较了 {shown} 份",
        documentsOmitted: "另有 {count} 份文档没有列出",
        unavailable: "该工程没有可用的版本控制",
    },
    /**
     * 整份取一边地收尾一次合并。
     *
     * 用词是「保留我的／保留对方的」而不是后端的 mine/theirs：按下「从服务器获取」的作者
     * 是在跟同伴的改动对齐，不是在做三路合并。
     *
     * `notSaved` 是这整个界面之所以诚实的那一句——哪些冲突已经决定过，没有任何地方读得出来，
     * 所以这份记录属于 Studio 而不属于仓库；说出来，好过暗示工程自己知道这份进度。
     *
     * 它原本还写着「仅在本窗口打开期间有效」，那句当时是真的，现在不是了：选择存在工程旁边的
     * 一份草稿里（`mergeDecisionDraft`）。没变的是要紧的那一半——按下完成之前一个文件都不动，
     * 所以现在只说这一句。草稿存在哪里不该由这行文案解释。
     */
    resolve: {
        tab: "合并",
        merging: "该工程的两个版本正在合并",
        none: "该工程没有正在进行的合并",
        automerged: "全部内容已自动合并，完成后记录为一个版本",
        count: {
            one: "有 {count} 个文件两边都改过，请选择保留哪一边",
            other: "有 {count} 个文件两边都改过，请选择保留哪一边",
        },
        takeMine: "保留我的",
        takeTheirs: "保留对方的",
        takeAllMine: "全部保留我的",
        takeAllTheirs: "全部保留对方的",
        rowsOmitted: "另有 {count} 个文件未列出，可用上方的两个链接一次性选择",
        /** 两栏：左边是有冲突的文件，右边是选中文件内部的变更。 */
        fileList: "有冲突的文件",
        decision: "保留哪一边",
        /** 三态里唯一带标记的一态：它是拦住「完成合并」的那一态，必须一眼找得到。 */
        pending: "尚未选边",
        selectPrompt: "选中一个文件，查看其中的变更",
        finish: "完成合并",
        finishUndecided: {
            one: "还有 {count} 个文件没选边",
            other: "还有 {count} 个文件没选边",
        },
        notSaved: "完成合并之前不会写入任何文件",
        abandon: "放弃合并",
        abandonConfirm: "放弃这次合并？",
        abandonConfirmDetail:
            "所有文件都会回到从服务器获取之前的状态，包括已经自动合并的文件；本地内容不会丢失，需要时可以再次获取",
        /**
         * 第二档：在一个文件内部逐条变更选边。
         *
         * `auto` 那一档是**合并自己**已经定下来的，不是作者定的，所以画成已决定、把另一边收进
         * 悬停里——绝大多数时候什么都不按才是对的答案。`conflict` 那一档则一边都不预选。
         * `blocked` 下面几句说的是「为什么这个文件没有逐条列表」，而不是「列表是空的」。
         */
        change: {
            expand: "展开内部变更",
            collapse: "收起内部变更",
            loading: "正在读取两个版本…",
            heading: "未标注的行是自动合并的结果；悬停在某一行上可以改用另一边",
            none: "该文件的两个版本内容完全一致",
            auto: "已自动合并",
            useMine: "改用我的",
            useTheirs: "改用对方的",
            absent: "这一边没有",
            moreFields: "另有 {count} 项",
            undecided: {
                one: "还有 {count} 条变更没选边",
                other: "还有 {count} 条变更没选边",
            },
            blocked: {
                title: "该文件只能整份取一边",
                noSpec: "Studio 无法识别该文件的格式，不能只合并其中一部分",
                noMerge3: "Studio 可以读取该格式，但不能把两个版本逐条合并",
                readOnly: "Studio 可以合并该格式，但无法写回结果，因此整个文件只能取一边",
                tooLarge: "该文件过大，无法逐条合并",
                tooMany: "该文件的变更过多，无法逐条决定",
                unreadable: "两个版本中有一个无法读取，因此只能整份取一边",
            },
        },
    },
    /** 把一个页面 / 一张图的两个版本并排画出来，改动直接盖在原处。两块画布共用同一套词。 */
    canvas: {
        before: "更改前",
        after: "更改后",
        surfaceLabel: "页面",
        graphLabel: "蓝图",
        unnamed: "未命名",
        /** `moved` 特意写清楚它为什么画得最淡：它不改变游戏的行为。 */
        legend: {
            added: "新增",
            removed: "删除",
            changed: "已修改",
            moved: "仅位置变动",
        },
        markLabel: "查看这条改动",
        /** 与蓝图编辑器同一个词：同一张图、同一个结果，换个说法会被读成另一种行为。 */
        fitView: "适应视图",
        oneChange: "只显示一条改动",
        showAll: "显示全部改动",
        /** 画布没有标出来的那些改动，一行说清；标了九条却不说另外三条，读起来就像一共只有九条。 */
        notMarked: {
            one: "另有 {count} 条改动没有标在这里：",
            other: "另有 {count} 条改动没有标在这里：",
        },
        onOtherPages: "{count} 条在其他页面",
        onOtherGraphs: "{count} 条在其他蓝图",
        offCanvas: "{count} 条在所有页面之外",
        /** 组件内部的元素本来就不带 id：同一个组件的每个实例共用内部 id，带上就分不清是哪一处放置。 */
        unplaced: "{count} 条在页面上没有位置",
        notDrawn: "该版本的页面无法绘制",
        emptyGraph: "这张图里没有节点",
        tooLarge: "该文件过大，无法在此绘制",
        unreadable: "该文件无法按界面文档读取：{error}",
        readFailed: "该版本无法读取：{error}",
    },
} satisfies LocaleNamespace<"documentDiff">;
