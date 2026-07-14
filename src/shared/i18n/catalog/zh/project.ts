import type { LocaleNamespace } from "../types";

export const project = {
    nav: {
        details: {
            title: "详情",
            description: "名称、标识符与元数据",
        },
        assets: {
            title: "图标",
            description: "各平台的应用图标",
        },
        dependencies: {
            title: "依赖",
            description: "本项目依赖的插件",
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
        iconMissing: "图标文件缺失",
        iconSaved: "{platform} 图标已保存",
        uploadIcon: "上传 {platform} 图标",
        iconAlt: "{platform} 图标",
        noIcon: "未选择图标",
        icnsPreview: "ICNS 预览",
    },
    settings: {
        allowHttpTitle: "允许 HTTP",
        allowHttpDescription: "关闭时，游戏将被限制在应用协议内，所有 HTTP/HTTPS 请求均会被阻止",
        encryptAssetsTitle: "资源保护",
        encryptAssetsDescription: "在打包及预览版本中加密素材、插件代码及剧情数据，可提高非专业手段提取的难度，但不影响开发者模式",
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
