import type { LocaleNamespace } from "../types";

export const settings = {
    title: "设置",
    searchPlaceholder: "搜索设置…",
    loading: "正在加载设置…",
    noResults: "没有匹配的设置",
    empty: "暂无可用设置",
    noneExposed: "该分区没有可配置的设置",
    invalidValue: "请输入有效的值",
    persistFailed: "保存设置失败",
    resetToDefault: "恢复默认值",
    customColor: "自定义颜色…",
    fontPicker: {
        searchPlaceholder: "搜索字体…",
        presets: "预设",
        installed: "本机字体",
        sample: "AaBb 字体",
        noMatches: "没有匹配的字体",
        loading: "正在读取本机已安装的字体…",
        unavailable: "当前版本无法列出本机字体，上面的预设仍然可用",
        denied: "Studio 无法读取本机已安装的字体；请将此窗口切换到前台，然后重新展开列表",
        failed: "读取本机字体失败：{message}",
        notInstalled: "未安装",
    },
    categories: {
        general: {
            label: "常规",
            description: "应用默认项、语言与通知",
        },
        appearance: {
            label: "外观",
            description: "界面主题、强调色与动效偏好",
        },
        editor: {
            label: "编辑器",
            description: "字体渲染、行号、自动换行与布局默认值",
        },
        workspace: {
            label: "工作区",
            description: "启动行为、工作区历史与自动保存",
        },
        shortcuts: {
            label: "快捷键",
            description: "Studio 中各条命令绑定的按键",
        },
        versionControl: {
            label: "版本控制",
            description: "提交版本的记录频率，以及记在上面的身份",
        },
        servers: {
            label: "服务器",
            description: "本安装已登录的服务器，以及登录所用的账号",
        },
        network: {
            label: "网络",
            description: "Studio 从哪里下载插件、模板与构建工具",
        },
        data: {
            label: "数据",
            description: "缓存文件、还原偏好设置，以及在设备之间搬运它们",
        },
    },
    items: {
        language: {
            label: "语言",
            description: "Studio 界面的显示语言",
        },
        developerMode: {
            label: "开发者选项",
            description: "右键菜单中增加一组操作，用于复制所选对象的 ID",
        },
        confirmQuit: {
            label: "在使用 ⌘Q 退出时二次确认",
            description: "连按两次 ⌘Q 才会退出，按一次不退出",
            unsupportedPlatform: "此选项不适用于此操作系统",
        },
        themeMode: {
            label: "主题",
            description: "Studio 界面的配色主题",
            options: {
                auto: "跟随系统",
                light: "亮色",
                dark: "暗色",
            },
        },
        accentColor: {
            label: "强调色",
            description: "选中项、焦点框和主要按钮所用的颜色",
            options: {
                teal: "叶青",
                sky: "天蓝",
                indigo: "靛蓝",
                rose: "玫瑰",
                slate: "石板",
            },
        },
        tooltipDelay: {
            label: "提示延迟",
            description: "指针停在控件上多久后出现提示。在同一个工具栏内，只有第一条提示需要等待",
        },
        reduceMotion: {
            label: "减少动效",
            description: "关闭 Studio 界面中的动画过渡，不影响游戏本身的动画",
        },
        zoomPercent: {
            label: "界面缩放",
            description: "Studio 界面的缩放比例（{min}%-{max}%）",
        },
        editorFontSize: {
            label: "故事编辑器字号",
            description: "场景编辑器中故事文本的字号（px，{min}-{max}）",
        },
        editorFontFamily: {
            label: "故事编辑器字体",
            description: "场景编辑器中故事文本使用的字体，可从本机已安装的字体中选择",
            options: {
                default: "默认",
                sansSerif: "无衬线",
                serif: "衬线",
                monospace: "等宽",
            },
        },
        editorSurfaceOpacity: {
            label: "编辑面不透明度",
            description: "故事正文与检查器字段背后阅读面的不透明度",
        },
        maxActiveEditors: {
            label: "最大活动编辑器数",
            description: "同时保持加载并保留滚动位置与焦点的编辑器标签数（{min}-{max}）；其余标签在重新打开时重新加载",
        },
        blueprintDragConnectExecOutput: {
            label: "从执行输出引脚拖拽创建节点",
            description: "拖到空白画布后松开即可选择节点，该节点接在此引脚之后",
        },
        blueprintDragConnectDataOutput: {
            label: "从数据输出引脚拖拽创建节点",
            description: "拖到空白画布后松开即可选择节点，菜单只列出接受该数据类型的节点",
        },
        blueprintDragConnectInput: {
            label: "从输入引脚拖拽创建节点",
            description: "拖到空白画布后松开即可选择节点，该节点的输出连到此引脚",
        },
        slashAtAlias: {
            label: "用“@”打开动作创建",
            description: "以防中文输入法的「/」与「、」冲突",
        },
        localizedCommands: {
            label: "指令跟随界面语言",
            description: "关闭后，动作创建中的指令名、参数名与取值保持英文；无论显示哪种语言，英文写法始终可用",
        },
        hideParamNames: {
            label: "指令只显示参数值",
            description: "更紧凑地显示行内指令",
        },
        storyRowHighlight: {
            label: "高亮故事行",
            description: "给其中一类行加一层底色，使其与其余行区分开",
            options: {
                none: "不高亮",
                script: "高亮对白行",
                command: "高亮指令行",
            },
        },
        dictionaries: {
            label: "拼写词典",
        },
        spellcheckLanguage: {
            label: "拼写检查语言",
            description: "在故事正文中标出拼写错误。译文一律不检查",
            noDictionary: "尚未安装本工程所用语言的拼写词典。",
            options: {
                followProject: "跟随工程语言",
                off: "不检查拼写",
            },
        },
        detachedEditorOnClose: {
            label: "独立编辑器关闭窗口后的行为",
            description: "在独立窗口中打开的编辑器，关窗后回到工作区或随窗口一同关闭",
            options: {
                restoreTab: "回到工作区",
                close: "关闭编辑器",
            },
        },
        editorLineNumbers: {
            label: "显示行号",
            description: "用于从资产库打开文件的内建文本编辑器",
        },
        editorSoftWrap: {
            label: "长行自动换行",
            description: "内建文本编辑器不再横向滚动，而是把长行折下来",
        },
        recentProjectsLimit: {
            label: "保留的最近项目数",
            description: "主页和「打开最近的项目」菜单各保留多少个",
        },
        electronMirror: {
            label: "Electron 下载镜像",
            description: "下载 Electron 所用的镜像地址，留空则使用官方源",
        },
        electronBuilderBinariesMirror: {
            label: "构建工具下载镜像",
            description: "构建时下载安装器工具（NSIS、AppImage、代码签名辅助程序）所用的镜像地址，留空则使用官方源",
        },
        downloadRewrites: {
            label: "下载地址替换",
        },
        pluginRegistryUrl: {
            label: "插件注册表地址",
            description: "插件商店从哪里取索引，留空则使用 NarraLeaf 官方注册表",
        },
        uiTemplateRegistryUrl: {
            label: "界面模板注册表地址",
            description: "模板商店从哪里取索引，留空则使用 NarraLeaf 官方注册表",
        },
        checkpointInterval: {
            label: "自动检查点间隔",
            description: "间隔多久记录一个检查点，只在确实有改动时记录；填 0 则关闭",
        },
        checkpointOnClose: {
            label: "关闭工作区时记录检查点",
            description: "关窗时记录一次，与上面的间隔各自独立",
        },
        versionControlAuthor: {
            label: "作者名",
            description: "记录为提交与检查点的作者，留空则记为 NarraLeaf Studio",
            fromServer: "来自本安装已登录的服务器。退出登录后可重新记录你自己的名字。",
        },
        versionControlAuthorEmail: {
            label: "作者邮箱",
            description: "与作者名一起记录，形如「作者名 <邮箱>」，留空则不记录地址",
        },
        confirmBeforeClose: {
            label: "关闭工作区时弹出提示",
            description: "关闭工作区窗口时先询问确认",
        },
        returnToLauncherOnClose: {
            label: "关闭工作区后返回首页",
            description: "关闭此项则在没有其他窗口时直接退出 NarraLeaf Studio",
        },
        dashboardOnOpen: {
            label: "默认显示项目仪表盘",
            description: "对尚未单独设置过的项目生效，各项目可自行覆盖",
        },
        clearAllStats: {
            label: "清空所有统计数据",
            description: "清除所有项目的写作历史、活跃时长和构建历史；从项目内容统计得出的数字不受影响",
            action: "清空",
            confirm: "确认清空",
        },
        statusBarVisible: {
            label: "显示状态栏",
            description: "工作区底部的状态栏",
        },
        titleBarSearchVisible: {
            label: "显示标题栏搜索框",
            description: "标题栏中间的搜索框",
        },
        backgroundImage: {
            label: "自定义背景图",
            description: "在工作区背后显示指定的图片",
            action: "配置…",
            needsWorkspace: "打开工作区后才能配置背景图",
        },
        keybindings: {
            label: "快捷键",
        },
        servers: {
            label: "服务器",
        },
        cacheInventory: {
            label: "缓存文件",
        },
        settingsTransfer: {
            label: "在设备之间迁移设置",
        },
        resetWorkspaceLayout: {
            label: "还原工作区布局",
            description: "把面板、侧栏和已打开的编辑器标签恢复为初始状态；工程内容不受影响",
            action: "还原",
            confirm: "还原布局",
        },
        resetAllPreferences: {
            label: "还原所有设置",
            description: "把所有设置恢复为默认值；工程、工程历史和统计数据不受影响",
            action: "还原",
            confirm: "全部还原",
        },
    },
    dictionaries: {
        loading: "正在加载…",
        remove: "移除",
        browse: "查看可用词典",
        refresh: "重新获取",
        browsing: "正在加载…",
        download: "下载",
        downloading: "正在下载…",
        failed: "无法获取词典列表。请检查设置中的网络策略。",
        installed: {
            title: "已安装",
            emptyTitle: "尚未安装词典",
            emptyDescription: "下载词典后即可对正文进行拼写检查。",
        },
        available: {
            title: "可下载",
            prompt: "尚未获取词典列表。",
            none: "可用词典已全部安装。",
        },
    },
    servers: {
        empty: "尚未添加服务器",
        openAdd: "添加服务器",
        add: "添加",
        adding: "正在添加…",
        cancel: "取消",
        continue: "继续",
        checking: "正在检查…",
        done: "完成",
        signOut: "退出登录",
        addressLabel: "服务器地址",
        addressPlaceholder: "nlteam://studio.example.lan:41402",
        reached: "{address} 响应的服务器为 {name}",
        tokenLabel: "访问令牌",
        tokenPlaceholder: "粘贴访问令牌",
        hint: "访问令牌由服务器管理员签发",
        noAccount: "{name} 不要求身份验证，无需添加",
        probe: {
            unreachable: "该地址没有响应",
            notAServer: "该地址有响应，但它不是 NarraLeaf Team 服务器",
            untrusted: "该地址的服务器未被信任",
            failed: "无法检查该地址",
        },
        problems: {
            scheme: "登录地址必须以 https:// 或 ucs-auth:// 开头",
            token: "该文本不是此服务器签发的令牌",
            address: "该令牌未写明登录地址",
            server: "该令牌未写明对应的服务器",
            certificate: "本机不信任该地址出示的证书",
            unreachable: "该地址没有响应",
            refused: "服务器拒绝了该令牌，可能已过期或已被作废",
            unknown: "无法添加该服务器",
        },
    },
    data: {
        cache: {
            measuring: "正在统计…",
            unavailable: "无法读取",
            clear: "清理",
            clearAll: "全部清理",
            refresh: "重新统计",
            freed: "已释放 {size}",
            buckets: {
                electronBuilder: {
                    label: "游戏构建工具",
                    description: "构建时下载的 Electron 与安装器工具",
                },
                buildDependencies: {
                    label: "插件构建文件",
                    description: "插件为打包进游戏而下载的压缩包",
                },
                browser: {
                    label: "界面缓存",
                    description: "界面为加快下次启动而保留的数据",
                },
                pluginIcons: {
                    label: "插件商店缩略图",
                    description: "下次打开商店会重新下载",
                },
                uiTemplatePosters: {
                    label: "模板商店封面",
                    description: "下次打开商店时会重新下载",
                },
                spellcheckDictionaries: {
                    label: "拼写词典",
                    description: "为拼写检查下载的词表。工程自己的词条不在这里",
                },
                psdImports: {
                    label: "PSD 导入残留",
                    description: "导入 PSD 时写下的分层图片",
                },
                logs: {
                    label: "日志",
                    description: "导出诊断文件时使用的日志",
                },
            },
        },
    },
    transfer: {
        export: "导出…",
        import: "导入…",
        apply: "应用",
        exportHint: "把设置写入一份纯 JSON 文件；工作区背景图、提交版本上的署名、最近项目、统计数据和窗口布局仅保留在本机",
        exported: "已保存到 {path}",
        imported: "已应用 {count} 项设置",
        exportFailed: "设置保存失败",
        importFailed: "无法读取该文件",
        planSummary: "{change} 项将变更，{same} 项已相同，{skipped} 项跳过",
        skippedUnknown: "{key}：当前版本的 Studio 没有这项设置",
        skippedInvalid: "{key}：{reason}",
    },
    network: {
        test: "测试",
        probing: "正在检查…",
        probeAnswered: "该地址返回 {status}",
        probeNoAnswer: "没有响应：{error}",
        probeFailed: "检查未能执行",
        rewrites: {
            hint: "部分下载地址来自目录文件而不是上述设置，例如插件的安装包；此处的规则替换这类地址的开头部分",
            empty: "没有替换规则，下载使用地址原文",
            add: "添加规则",
            remove: "删除该规则",
            enabled: "启用该规则",
            fromPlaceholder: "https://github.com/",
            toPlaceholder: "https://your-mirror.example/gh/",
        },
    },
} satisfies LocaleNamespace<"settings">;
