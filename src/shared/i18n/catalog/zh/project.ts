import type { LocaleNamespace } from "../types";

export const project = {
    // 一行只报自己装了什么。原先是一句句「这个页面是干什么的」，读起来像主张而不是陈述，
    // 合并之后也撑不住：一页装了三块内容，没法用一句主张概括，却可以直接列出它装了什么。
    nav: {
        app: {
            title: "应用",
            description: "名称、项目版本、图标与插件",
        },
        game: {
            title: "游戏",
            description: "存档、玩家默认值与音频轨道",
        },
        // 按这一页最终要装的东西命名，而不是按它现在只有的那一块：目前只有配色，字体等其余外观
        // 设定要放到它旁边。
        design: {
            title: "设计",
            description: "颜色，以及由它们上色的控件",
        },
        project: {
            title: "工程",
            description: "分发密钥、工程检查的规则，以及什么会拦下构建",
        },
        runtimes: {
            title: "运行时",
            description: "Live2D 与 Spine 的绘制运行时",
        },
        settings: {
            title: "设置",
            description: "安全、签名、优化与移动端",
        },
    },
    // 区分子页里各块内容的小标题。标题只用名词，不写成句子：底下的行自己会说做什么。
    group: {
        details: "详情",
        appTags: "变体",
        userData: "玩家文件",
        icons: "图标",
        dependencies: "依赖",
        saving: "存档",
        olderSaves: "旧存档",
        language: "语言",
        playerDefaults: "玩家默认值",
        audioTracks: "音频轨道",
        // 「配色」子页的两块内容：作者自己定的颜色，以及跟随它们的槽位。该页其余文案都在 `brand`
        // 命名空间里，与它们命名的那份模型放在一起。
        brandColors: "颜色",
        brandControls: "控件",
        distribution: "分发密钥",
        linting: "工程检查",
        security: "安全",
        signing: "签名",
        optimization: "优化",
        crash: "崩溃",
        mobile: "移动端",
    },
    distribution: {
        description: "随工程保存，参与构建的每个人用的是同一把密钥。一个构建只接受用它自己那把密钥做出的补丁。",
        absent: "尚未创建密钥",
        rotatedAt: "上次更换于 {date}",
        createAction: "创建",
        replaceAction: "更换",
        replaceConfirm: "要更换分发密钥吗？",
        replaceConfirmDetail: "已经用当前密钥发布出去的构建，不会接受此后做出的补丁",
    },
    home: {
        untitledProject: "未命名项目",
    },
    subPage: {
        backAria: "返回项目概览",
    },
    details: {
        nameLabel: "应用名称",
        namePlaceholder: "应用名称",
        nameRequired: "应用名称为必填项",
        identifierLabel: "标识符",
        identifierHelper: "在项目创建时设定，用于打包",
        versionLabel: "项目版本",
        authorLabel: "作者",
        authorPlaceholder: "作者、组织或邮箱",
        websiteLabel: "网站",
        // 会写进打包后应用的文件属性与「关于」框。改在这里，构建对话框只回读不再询问。
        copyrightLabel: "版权",
        copyrightPlaceholder: "© 你的工作室",
        // 长文形式，与上面那一行分开：那一行进二进制的文件属性，这一段进玩家能打开的文件。
        copyrightTextLabel: "版权声明",
        copyrightTextPlaceholder: "用到的字体、音乐与素材，以及它们各自归谁所有…",
        copyrightTextHelper: "随游戏一起发布为 COPYRIGHT.txt；留空则不生成该文件",
        descriptionPlaceholder: "描述你的项目…",
        required: "必填",
    },
    // 发布出去的游戏把属于玩家的东西写在哪里。只陈述，不提供开关：这一部分没有任何设置，也不点名
    // 任何平台，把这些交给谁是作者自己的判断。描述只说这些路径是什么，到此为止。
    userData: {
        description: "发布后的游戏把玩家的存档与进度存放在该目录。修改应用名称不会移动它。",
        copy: "复制位置",
        copied: "位置已复制",
        copyFailed: "无法复制位置",
        platform: {
            windows: "Windows",
            macos: "macOS",
            linux: "Linux",
        },
        content: {
            saves: "存档槽",
            persistence: "持久变量、已解锁内容与插件数据",
        },
    },
    // 变体：同一个工程能发布出的几种成品。什么是变体、继承是什么意思，都在标题旁 `?` 打开的
    // `appTags` 帮助主题里；这里的文案只命名控件，并说明按下去会发生什么。
    appTags: {
        add: "新增变体",
        history: {
            add: "新增变体 {name}",
            rename: "把变体改名为 {name}",
            delete: "删除变体 {name}",
            edit: "修改构建变体",
        },
        newTagName: "新变体",
        nameTitle: "名称",
        fields: {
            displayName: "应用名称",
            identifier: "标识符",
            version: "项目版本",
        },
        // 只在该字段自己填了值时出现在它旁边，所以它既是「此处被覆盖」的标记，也是取消覆盖的入口。
        restore: "恢复继承",
        reachableTitle: "可以开始的场景",
        // 该变体的构建可以交给玩家浏览器打开的地址。按这份清单决定什么来命名，而不是按机制；整份
        // 清单一起覆盖：一个变体要么有自己的清单，要么读工程的。
        // 该变体的构建在剧本走完之后显示的页面。按作者看到的结果命名，而不是按背后的引擎事件。
        ending: {
            title: "剧本结束后显示的页面",
            // 这是一个真正的选项，不是「没填」：画面停在最后一帧，也就是这个字段出现之前每个构建的行为。
            none: "不显示任何页面",
        },
        // 在打开的变体里紧挨删除按钮：确认框接下来要说的就是这个数字。
        usedBy: {
            one: "被 {count} 处引用",
            other: "被 {count} 处引用",
        },
        delete: "删除",
        deleteConfirm: "删除「{name}」？",
        // 如实说明后果：指向该变体的引用不会被改写，从此按正式变体的值读取。`{name}` 是正式变体的
        // 名称，插值而不是写死在这里，将来改名时这句会跟着改。
        deleteDetail: {
            one: "{count} 处引用将回落到 {name}",
            other: "{count} 处引用将回落到 {name}",
        },
        // 后果的另一半，说的是那些写在剧本里的引用：截断点会保留下来，而不指向任何变体的截断点不再截断
        deleteDetailCuts: {
            one: "剧本中的 {count} 处截断点将保留，并不再生效",
            other: "剧本中的 {count} 处截断点将保留，并不再生效",
        },
    },
    assets: {
        master: "选择应用图标",
        override: "覆盖",
        chooseOverride: "为该平台单独选择图片",
        clearOverride: "此处改用应用图标",
        inset: "内边距",
        background: "底色",
        clearBackground: "保留透明",
        transparent: "无",
        icnsPreview: "ICNS 预览",
        target: {
            macos: "macOS",
            windows: "Windows",
            linux: "Linux",
            android: "Android",
            ios: "iOS",
            web: "Web",
        },
    },
    game: {
        autoSaveTitle: "自动保存",
        autoSaveDescription: "按间隔自动保存进度。崩溃时最多损失一个间隔内的进度",
        autoSaveIntervalTitle: "保存间隔",
        autoSaveIntervalDescription: "保存进度的间隔；剧情没有推进时不写入",
        autoSaveIntervalUnit: "秒",
        autoSaveSlotsTitle: "保留数量",
        autoSaveSlotsDescription: "自动存档在指定数量的槽位间轮转，最旧的先被覆盖，与玩家自己的存档槽相互独立",
        saveCompatibleTitle: "其他项目版本的存档",
        saveCompatibleDescription: "故事未变更，仅项目版本不同",
        saveIncompatibleTitle: "故事变更前的存档",
        saveIncompatibleDescription: "存档写入之后故事已变更",
        saveResume: "恢复进度",
        saveDiscard: "不恢复进度",
        saveResumeScene: "尝试恢复到场景",
        saveForce: "强制载入",
        languageInGameTitle: "游戏进行中切换语言",
        languageInGameDescription: "在标题画面切换时，两种设置的表现相同",
        languageRestart: "重启并回到原处",
        languageNextScene: "从下一个场景开始生效",
    },
    preferences: {
        // 挂在小标题上的一句话，不再是页首的一段话。原先那段里其余的内容，要么行本身就写着，
        // 要么对正在看这些行的作者没有用处。
        intro: "玩家未修改时，各项设置从这里的值开始；玩家可以修改全部设置，修改结果会被保留",
        group: {
            dialogue: "对白",
            skipping: "跳过",
            // 不叫「音频」：混音台现在就在同一页上，隔一屏出现两个「音频」小标题，
            // 正是这次合并要消掉的那种混淆。
            audio: "声音",
        },
        unit: {
            percent: "%",
            ms: "毫秒",
            cps: "字/秒",
        },
        cps: {
            title: "文字速度",
            description: "每秒打出的字数",
        },
        gameSpeed: {
            title: "游戏速度",
            description: "同时作用于打字速度和自动前进的等待时间",
        },
        autoForward: {
            title: "自动前进",
            description: "一句显示完之后自动进入下一句",
        },
        showDialog: {
            title: "显示对话框",
            description: "关闭后游戏以隐藏对话框的状态启动",
        },
        skip: {
            title: "允许跳过",
            description: "关闭后跳过键不起作用",
        },
        skipReadText: {
            title: "跳过已读文本",
            description: "开启后，跳过遇到玩家还没读过的文本就会停下",
        },
        skipDelay: {
            title: "跳过延迟",
            description: "跳过键按住多久之后开始连续跳过",
        },
        skipInterval: {
            title: "跳过间隔",
            description: "连续跳过时每句之间的间隔，越大越慢",
        },
        globalVolume: {
            title: "总音量",
            description: "作用于全部音频",
        },
        bgmVolume: {
            title: "音乐音量",
            description: "音乐音轨",
        },
        soundVolume: {
            title: "音效音量",
            description: "音效音轨",
        },
        voiceVolume: {
            title: "语音音量",
            description: "语音音轨",
        },
        voiceEndMode: {
            title: "语音随句子结束时",
            description: "无论选择哪一项，都不会有两条语音同时播放",
            option: {
                stop: "立即停止",
                fade: "淡出",
                none: "继续播放",
            },
        },
        voiceFadeDuration: {
            title: "语音淡出时长",
            description: "淡出持续多久，只在语音以淡出方式结束时生效",
        },
    },
    // 音频子页：一条总线一行，字段收在折叠里。下面这些是「标签」不是「标题」——
    // 原先每个字段各带一段说明，三条轨道就是三遍同样的话，现在只在 intro 里说一次。
    audio: {
        // 什么是总线、音量如何逐级相乘，已经移进 `audio` 帮助主题，由本区标题上的 `?` 打开。
        // 它原先是这里的一段话，再往前是每条轨道的每个字段上都写一遍。
        add: "新建轨道",
        history: {
            add: "新建音轨 {name}",
            delete: "删除音轨 {name}",
            edit: "修改音轨",
        },
        newTrackName: "新建轨道",
        nameTitle: "名称",
        parentTitle: "汇入",
        parentMaster: "主输出",
        volumeTitle: "音量",
        volumeUnit: "%",
        loopTitle: "默认循环",
        loopDescription: "在该轨道上播放的片段默认循环，除非播放它的动作另有指定",
        duplicate: "复制",
        delete: "删除",
        // 展开后紧挨着「删除」：确认框接下来要说的就是这个数字。
        usedBy: {
            other: "被 {count} 处引用",
        },
        deleteConfirm: "删除「{name}」？",
        // 诚实地说明后果：指向这条轨道的地方不会被改写，从此各自按自身形态对应的内置总线解析——
        // 具体落到哪一条取决于播放的是什么，在这里点名某一条只会是猜测。
        deleteDetail: {
            other: "{count} 处引用将各自回落到默认总线",
        },
        // 子总线会被上提而不是一并删除，并且明确告诉作者它们落到哪里。
        deleteChildren: {
            other: "其下的 {count} 条轨道将移到 {parent}",
        },
        // 玩家自己的音量滑块，与三条内置总线一一对应。
        slider: {
            bgm: "BGM 音量",
            sound: "音效音量",
            voice: "语音音量",
            // 不经由三条内置总线、直接挂在主输出下的总线没有专属滑杆，玩家只能用全局音量控制它
            global: "全局音量",
        },
    },
    settings: {
        crashPolicyTitle: "游戏停止工作时",
        crashPolicyDescription: "三种方式都会将错误写入游戏日志",
        crashPolicy: {
            details: "显示错误内容",
            log: "只报告已停止",
            restart: "重新启动游戏",
        },
        networkPolicyTitle: "网络策略",
        networkPolicy: {
            off: "不允许联网",
            allowlist: "仅白名单内的地址",
            any: "任意地址",
        },
        networkPolicyDetail: {
            off: "所有 HTTP 与 HTTPS 请求都会被拒绝",
            allowlist: "只有下方白名单中的地址可以被请求，其余请求会被拒绝",
            any: "游戏可以通过 HTTP 或 HTTPS 请求任意地址",
        },
        networkPolicyWebHint: "Web 导出通过 HTTP 提供，无法执行「不允许联网」；白名单照常执行",
        networkAllowlist: {
            title: "网络请求白名单",
            description: "每行一个地址或主机模式",
            matchHint: "只写主机表示该主机下的所有路径；* 可以替换首个主机标签（*.example.com），或出现在路径末尾（/v1/*）；协议、主机与端口需完全一致",
            placeholder: "https://api.example.com/*",
            invalid: "请填写 http:// 或 https:// 地址；* 只能替换首个主机标签，或出现在路径末尾",
            add: "新增地址",
            remove: "移除地址",
            fromPlugins: "已安装插件声明的地址",
            sidecarNote: "插件附带的程序在游戏进程之外运行，不受该白名单约束",
        },
        encryptAssetsTitle: "加密资源",
        encryptAssetsDescription: "在打包及预览构建中加密资源、插件代码与剧本数据，不影响开发模式",
        encryptAssetsWebHint: "Web 构建始终不加密资源",
        // 「签名」这一块的一行说明。每个可签名平台都有一行，不管本机能不能构建它：证书往往在用到它的
        // 那次构建之前几天就要备好，这份准备工作正是它落在面板里、而不是构建对话框里的原因。
        signingDescription: "为每个平台指定签名凭据；证书与密码只留在本机，工程里存的只有用哪一份",
        webLosslessImagesTitle: "图像转为 WebP",
        webLosslessImagesDescription: "在体积更小时，将导出的图像重编码为无损 WebP",
        webLosslessImagesHint: "转换后的图像解码结果与原图完全一致；Android 与 iOS 构建使用同一份导出站点，因此该设置对它们同样生效",
        webPrecompressTitle: "预压缩文本文件",
        webPrecompressDescription: "为站点的脚本、样式与剧本数据额外生成 Brotli 与 Gzip 副本",
        webPrecompressHint: "只有配置了预压缩支持的服务器会用到该副本，其余主机提供原文件",
        webLossyImagesTitle: "重压缩图像",
        webLossyImagesDescription: "将导出的图像重编码为有损 WebP；体积明显更小，损失的画面细节无法恢复",
        webLossyQualityTitle: "图像质量",
        webLossyQualityDescription: "重压缩时使用的 WebP 质量，取值 1 到 100",
        webSharedWithMobileHint: "Android 与 iOS 构建使用同一份导出站点，因此该设置对它们同样生效",
        // 不叫「移动端方向」：它就在「移动端」小标题底下，重复那个词还会让标签在 318px 面板里换行。
        orientationTitle: "屏幕方向",
        orientationDescription: "移动端构建启动时锁定的屏幕方向",
        orientation: {
            landscape: "横屏",
            portrait: "竖屏",
            auto: "跟随设备",
        },
        stageFitTitle: "屏幕适配",
        stageFitDescription: "对移动端构建与开发模式生效；桌面与 Web 始终留黑边",
        stageFit: {
            contain: "留黑边",
            cover: "填满并裁剪",
        },
        cropAnchorYTitle: "垂直保留",
        cropAnchorYDescription: "屏幕比舞台更宽时保留哪一部分",
        cropAnchorY: {
            top: "顶部",
            center: "居中",
            bottom: "底部",
        },
        cropAnchorXTitle: "水平保留",
        cropAnchorXDescription: "屏幕比舞台更窄时保留哪一部分",
        cropAnchorX: {
            left: "左侧",
            center: "居中",
            right: "右侧",
        },
    },
    dependencies: {
        rescan: "重新扫描",
        scanning: "正在扫描项目…",
        empty: "没有插件依赖",
        banner: {
            blocked: "部分插件已被禁用，已安装版本不兼容；请更新或重新安装",
            warnings: "某个插件版本过旧，或某项可选依赖不可用",
        },
        status: {
            ready: "就绪",
            outdated: "已过时",
            missing: "缺失",
            incompatible: "不兼容",
            disabled: "已禁用",
        },
        meta: {
            requires: "需要 {version}",
            installed: "已安装 {version}",
            notInstalled: "未安装",
            builtIn: "内置",
            dataOnly: "仅数据",
        },
        usage: {
            blueprintNode: {
                one: "{count} 个节点",
                other: "{count} 个节点",
            },
            widget: {
                one: "{count} 个挂件",
                other: "{count} 个挂件",
            },
            storage: {
                one: "{count} 个存储",
                other: "{count} 个存储",
            },
            storyAction: {
                one: "{count} 个动作",
                other: "{count} 个动作",
            },
        },
    },
} satisfies LocaleNamespace<"project">;
