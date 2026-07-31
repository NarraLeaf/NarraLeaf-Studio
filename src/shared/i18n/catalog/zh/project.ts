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
        autoSaveDescription: "玩家在游戏中时按间隔自动保存进度，崩溃或误关窗口只损失片刻，而不是一整段游玩",
        autoSaveIntervalTitle: "保存间隔",
        autoSaveIntervalDescription: "多久检查一次。剧情没有推进就不会写入，因此挂机不产生任何开销",
        autoSaveIntervalUnit: "秒",
        autoSaveSlotsTitle: "保留数量",
        autoSaveSlotsDescription: "自动存档在这么多个槽位间轮转，最旧的先被覆盖。它们不会混进玩家自己的存档槽，用「列出自动存档」节点读取",
    },
    settings: {
        allowHttpTitle: "允许 HTTP",
        allowHttpDescription: "关闭时，游戏将被限制在应用协议内，所有 HTTP/HTTPS 请求均会被阻止",
        allowHttpWebHint: "对 Web 导出不适用：网页游戏本身经由 HTTP(S) 分发，此设置仅影响桌面构建",
        encryptAssetsTitle: "加密资源",
        encryptAssetsDescription: "在打包及预览版本中加密资源、插件代码与剧本数据，让解包变得困难，但不影响开发模式",
        encryptAssetsWebHint: "对 Web 导出不适用：Web 构建始终不加密资源",
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
            blocked: "由于已安装版本不兼容，本项目中的部分插件已被禁用，请更新或重新安装以恢复完整功能",
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
