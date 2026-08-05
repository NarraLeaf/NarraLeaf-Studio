import type { LocaleNamespace } from "../types";

export const project = {
    nav: {
        details: {
            title: "详情",
            description: "名称、标识符与元数据",
        },
        game: {
            title: "游戏",
            description: "成品游戏对玩家的表现",
        },
        preferences: {
            title: "偏好设置",
            description: "新玩家的各项设置从什么值开始",
        },
        audio: {
            title: "音频",
            description: "混音台：总线之间如何汇入，各自多大声",
        },
        assets: {
            title: "图标",
            description: "各平台的应用图标",
        },
        dependencies: {
            title: "依赖",
            description: "本项目依赖的插件",
        },
        runtimes: {
            title: "运行时",
            description: "Live2D 与 Spine 角色的绘制运行时",
        },
        linting: {
            title: "检查",
            description: "工程检查报告哪些问题",
        },
        settings: {
            title: "设置",
            description: "网络与打包行为",
        },
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
        versionLabel: "版本",
        authorLabel: "作者",
        authorPlaceholder: "作者、组织或邮箱",
        websiteLabel: "网站",
        descriptionPlaceholder: "描述你的项目…",
        required: "必填",
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
        autoSaveDescription: "按间隔自动保存进度，崩溃时只损失片刻，而不是一整段游玩",
        autoSaveIntervalTitle: "保存间隔",
        autoSaveIntervalDescription: "多久检查一次。剧情没有推进就不会写入",
        autoSaveIntervalUnit: "秒",
        autoSaveSlotsTitle: "保留数量",
        autoSaveSlotsDescription: "自动存档在这么多个槽位间轮转，最旧的先被覆盖，不会混进玩家自己的存档槽",
    },
    preferences: {
        intro: "玩家没有改动过时，各项设置从这里的值开始。游戏运行时它们仍然可以被玩家改，改完的值会随应用保存下来。",
        group: {
            dialogue: "对话",
            skipping: "跳过",
            audio: "音频",
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
            description: "关闭后游戏以隐藏对话框的状态开始，与玩家自己按下隐藏界面时一样",
        },
        skip: {
            title: "允许跳过",
            description: "关闭后跳过键完全不起作用",
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
            description: "游戏播放的一切声音",
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
            description: "一句话说完之后，这条语音怎么处理",
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
        // 什么是总线、音量如何逐级相乘，在分区顶部说一次。它吸收了原来的
        // nameDescription / parentDescription / volumeDescription 三段。
        intro: "轨道就是一条总线：它汇入上级总线，或直接汇入主输出。片段的实际音量等于自身电平乘以其上每一条总线的音量，总线只能衰减。改名是安全的",
        add: "新建轨道",
        newTrackName: "新建轨道",
        nameTitle: "名称",
        parentTitle: "汇入",
        parentMaster: "主输出",
        volumeTitle: "音量",
        volumeUnit: "%",
        loopTitle: "默认循环",
        loopDescription: "在这条轨道上播放的片段默认循环，除非播放它的动作另有指定",
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
        allowHttpTitle: "允许 HTTP",
        allowHttpDescription: "关闭时，游戏将被限制在应用协议内，所有 HTTP/HTTPS 请求均会被阻止",
        allowHttpWebHint: "对 Web 导出不适用，此设置仅影响桌面构建",
        encryptAssetsTitle: "加密资源",
        encryptAssetsDescription: "在打包及预览版本中加密资源、插件代码与剧本数据，不影响开发模式",
        encryptAssetsWebHint: "对 Web 导出不适用：Web 构建始终不加密资源",
        webLosslessImagesTitle: "图像转为 WebP",
        webLosslessImagesDescription: "在体积更小时，将导出的图像重编码为无损 WebP",
        webLosslessImagesHint: "每次转换都会与原图逐像素比对，解码结果不一致即丢弃。Android 与 iOS 构建使用同一份导出站点，因此该设置对它们同样生效",
        webPrecompressTitle: "预压缩文本文件",
        webPrecompressDescription: "为站点的脚本、样式与剧本数据额外生成 Brotli 与 Gzip 副本",
        webPrecompressHint: "只有配置了预压缩支持的服务器会用到这些副本，其余主机一律照常提供原文件",
        webLossyImagesTitle: "重压缩图像",
        webLossyImagesDescription: "将导出的图像重编码为有损 WebP。体积小得多，但损失的画面细节无法恢复",
        webLossyQualityTitle: "图像质量",
        webLossyQualityDescription: "重压缩时使用的 WebP 质量，取值 1 到 100",
        webSharedWithMobileHint: "Android 与 iOS 构建使用同一份导出站点，因此该设置对它们同样生效",
        orientationTitle: "移动端方向",
        orientationDescription: "移动端构建启动时锁定的屏幕方向",
        orientation: {
            landscape: "横屏",
            portrait: "竖屏",
            auto: "跟随设备",
        },
    },
    dependencies: {
        rescan: "重新扫描",
        scanning: "正在扫描项目…",
        empty: "没有插件依赖，本项目仅使用 Studio 内置功能",
        banner: {
            blocked: "部分插件在本项目中被禁用：已安装版本不兼容。请更新或重新安装",
            warnings: "部分依赖项需要处理，某个插件版本过旧或某项软依赖不可用",
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
