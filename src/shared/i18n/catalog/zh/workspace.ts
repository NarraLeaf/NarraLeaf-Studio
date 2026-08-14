import type { LocaleNamespace } from "../types";

export const workspace = {
    localization: {
        panel: {
            languagesTitle: "语言",
            languagesHint: "游戏本体的语言；源语言是故事的编写语言，其余语言以它为基准翻译",
            addLanguage: "添加语言",
            codePlaceholder: "代码（en、ja、zh-CN…）",
            namePlaceholder: "显示名称",
            invalidCode: "语言代码只能包含字母、数字和连字符",
            sourceBadge: "源语言",
            more: "更多",
            confirm: "确认",
            setSource: "设为源语言",
            removeLanguage: "移除语言",
            removeConfirm: "移除 {name}？",
            removeConfirmDetail: "译文仍保留在磁盘上，再次添加该语言时会恢复",
            openTable: "打开翻译表",
            progress: "已翻译 {completed}/{total}",
            staleCount: "{count} 条待校对",
            importSummary: "已导入 {applied} 条翻译（{unchanged} 条未变更，{unknown} 条未知，{skippedEmpty} 条空译文已跳过）",
        },
        settings: {
            menu: "语言设置…",
            title: "{name}的语言设置",
            displayNameLabel: "显示名称",
            fallbackLabel: "回退语言",
            fallbackHint: "这里缺少译文的条目改用该语言，该语言也没有时使用源语言",
            fallbackLoops: "会绕回本语言",
        },
        exchange: {
            exportMenu: "导出翻译…",
            importMenu: "导入翻译…",
            importDialogTitle: "选择翻译文件",
            exportTitle: "导出{name}的翻译",
            formatLabel: "格式",
            formatCsv: "CSV",
            formatCsvHint: "Excel、Google 表格",
            formatXliff: "XLIFF 1.2",
            formatXliffHint: "Trados、memoQ、OmegaT",
            formatPo: "gettext PO",
            formatPoHint: "Poedit、Weblate、Crowdin",
            formatJson: "JSON",
            formatJsonHint: "脚本与自建流程",
            scopeLabel: "范围",
            scopeAll: "全部",
            scopePending: "未翻译与待校对",
            exportAction: "导出",
            exportDone: "已导出 {count} 条到 {path}",
            exportEmpty: "没有可导出的条目",
            importFailed: "无法读取该文件",
            importUnsupported: "可导入的格式为 CSV、XLIFF、PO 与 JSON",
            importNoRows: "该文件里没有翻译条目",
            importWarnings: "有 {count} 条被跳过，第一条：{first}",
            localeMismatch: "该文件标注的语言是 {declared}，仍要导入到{name}吗？",
            localeMismatchDetail: "译文写入所选语言，与文件中的标注无关",
        },
        table: {
            storyLabel: "范围",
            sourceUi: "界面文本",
            sourceKeys: "通用文本",
            modeTranslate: "翻译",
            modeReview: "审校",
            filterAll: "全部",
            filterUntranslated: "未翻译",
            filterStale: "待校对",
            filterCompleted: "已翻译",
            reviewFilterReviewed: "已校对",
            reviewFilterUnreviewed: "未校对",
            charactersGroup: "角色",
            characterSpeaker: "角色",
            addKey: "添加",
            keyNamePlaceholder: "键名（menu.start…）",
            keySourcePlaceholder: "源语言文案",
            invalidKeyName: "键名只能由字母、数字组成，中间可用点、下划线或连字符分隔",
            removeKey: "移除键",
            removeKeyConfirm: "移除 {name}？",
            removeKeyConfirmDetail: "该键的已有译文仍保留在语言文件中",
            sourceColumn: "原文",
            targetColumn: "译文",
            targetPlaceholder: "输入译文…",
            narrationSpeaker: "旁白",
            choiceSpeaker: "选项",
            markReviewed: "标记为已校对",
            unmarkReviewed: "退回已翻译",
            reviewApprove: "通过",
            reviewReturn: "退回",
            reviewPendingCount: "{count} 条待校对",
            reviewAllClear: "没有待校对的条目",
            staleHint: "翻译之后原文有改动；重新保存该译文即可标记为最新",
            placeholderHint: "请保留 {n} 占位符，它们用于渲染内联数值",
            emptyStory: "这个故事没有可翻译的文本",
            emptyFilter: "没有符合当前筛选的条目",
            noStories: "请先创建故事；故事中的台词会显示在这里供翻译",
            statusUntranslated: "未翻译",
            statusMachine: "机翻",
            statusTranslated: "已翻译",
            statusReviewed: "已校对",
            statusStale: "待复查",
        },
    },
    voice: {
        panel: {
            languagesTitle: "配音语言",
            languagesHint: "已有配音的语言，与文本语言相互独立",
            addLanguage: "添加配音语言",
            codePlaceholder: "代码（ja、en、zh-CN…）",
            namePlaceholder: "显示名称",
            invalidCode: "语言代码只能包含字母、数字和连字符",
            more: "更多",
            confirm: "确认",
            removeLanguage: "移除配音语言",
            removeConfirm: "移除 {name}？",
            removeConfirmDetail: "配音指派仍保留在磁盘上，再次添加该语言时会恢复",
            openTable: "打开配音表",
            progress: "已配音 {covered}/{total}",
            staleCount: "{count} 处待更新",
            exportScript: "导出录音脚本",
            exportPickup: "导出补录脚本（仅待更新）",
            importAudio: "导入音频…",
            exportDone: "已导出到 {path}",
            pickupEmpty: "没有需要补录的台词",
            importSummary: "已关联 {linked} 条（{unmatched} 条未匹配，{failed} 条失败）",
            importFailed: "无法导入音频文件",
            importScript: "导入录音本…",
            importScriptSummary: "应用了 {applied} 行（{unchanged} 行未变，{unknown} 行没有语音）",
            importScriptFailed: "无法读取该录音本",
            namingTitle: "录音文件名规则",
            namingHint: "可用占位符：{tokens}；导入的音频按此名称与台词匹配",
            namingReset: "恢复默认",
        },
        table: {
            storyLabel: "故事",
            groupByScene: "按场景",
            groupByCharacter: "按角色",
            modeAssign: "指派",
            modeAudition: "试听",
            filterAll: "全部",
            filterMissing: "缺失",
            filterOutdated: "待更新",
            filterVoiced: "已配音",
            filterApproved: "已审听",
            auditionFilterAll: "全部",
            auditionFilterApproved: "已审听",
            auditionFilterPending: "待审听",
            narrationSpeaker: "旁白",
            narrationGroup: "旁白",
            castPlaceholder: "配音演员…",
            assign: "指派音频",
            replace: "替换音频",
            remove: "移除配音",
            play: "播放",
            stop: "停止",
            approve: "通过",
            reject: "退回",
            clipMissing: "音频缺失",
            outdatedHint: "导入该配音之后台词有改动；重新导入音频即可标记为最新",
            noStories: "请先创建故事；故事中的口白台词会显示在这里供配音",
            emptyStory: "该故事没有可配音的口白台词",
            emptyFilter: "没有符合当前筛选条件的内容",
            auditionAllClear: "没有待试听的内容",
            auditionPendingCount: "{count} 项待处理",
            statusMissing: "缺失",
            statusVoiced: "已配音",
            statusApproved: "已审听",
            statusOutdated: "待更新",
            notePlaceholder: "备注…",
            dropHint: "拖入音频以指派",
        },
    },
    recovery: {
        enter: "以恢复模式打开",
        enterFailed: "无法进入恢复模式：{error}",
        panelTitle: "恢复",
        banner: {
            state: "恢复模式：只读，未加载插件",
            exit: "退出恢复模式",
        },
        intro: "运行一项检查会加载工程的对应部分并报告结果；可以加载的部分能够照常浏览",
        problems: {
            title: "发现的问题",
            count: "{count}",
            empty: "窗口打开过程中没有报告任何问题",
            showRaw: "原始错误",
            copy: "复制这条错误",
            copied: "已复制",
        },
        probes: {
            title: "加载检查",
            run: "运行",
            rerun: "重新运行",
            runAll: "全部运行",
            project: "工程清单",
            assets: "资产索引",
            story: "故事大纲",
            storyDocuments: "故事脚本",
            interface: "界面文档",
            characters: "人物",
            localization: "本地化",
            voice: "配音",
            variables: "持久变量",
            audioTracks: "音轨",
        },
        details: {
            noStories: "该工程没有故事",
            storiesRead: "已读取 {count} 个故事文档",
        },
        tools: {
            title: "工具",
            openFolder: "打开工程目录",
            copyAll: "复制全部信息",
            copiedAll: "诊断信息已复制",
            openFolderFailed: "无法打开工程目录：{error}",
        },
        lore: {
            title: "版本历史",
            loading: "正在检查版本控制",
            unavailable: "版本控制不可用：{reason}",
            notARepository: "该工程从未启用过版本控制",
            noService: "版本控制服务在这个窗口没有启动",
            disabledHint: "该工程没有可供恢复的版本历史",
            head: "当前位于版本 {version}，分支 {branch}",
            emptyHistory: "还没有提交过任何版本",
            noMessage: "（无说明）",
            checkpoint: "提交一个恢复点",
            checkpointDone: "已提交为 {revision}",
            checkpointNothing: "无需提交：当前版本和这些文件已经一致",
            checkpointFailed: "提交版本失败：{error}",
            restore: "恢复到该版本",
            restoreConfirm: "确认恢复 {version}？",
            restoreExplain: "工程中的每个文件都会被替换为该版本的内容；当前状态会先提交为一个版本，恢复结果作为新版本追加，不会删除任何版本",
            cancel: "取消",
            restoreDone: "已恢复到 {version}，正在重新打开为普通工作区",
            restoreUnrecorded: "文件已恢复，但新版本提交失败：{error}",
            restoreFailed: "恢复失败：{error}",
        },
        offer: {
            message: "该工程未能正常加载",
            detailOne: "有一个文件无法读取，本窗口中缺少工程的一部分内容；常见原因：保存被中断、同步或备份工具同时写入、插件干扰；此时继续编辑可能把残缺的状态写回磁盘，覆盖仍然完好的文件",
            detailMany: "有 {count} 个文件无法读取，本窗口中缺少工程的一部分内容；常见原因：保存被中断、同步或备份工具同时写入、插件干扰；此时继续编辑可能把残缺的状态写回磁盘，覆盖仍然完好的文件",
            enter: "以恢复模式打开",
        },
        operations: {
            enteredBecause: "触发恢复模式的错误",
            shellService: "启动恢复模式的服务",
            preflight: "检查工程目录",
            assetsShardCreate: "创建资产索引",
            assetsShardRead: "读取资产索引",
            storyIndexRead: "读取故事大纲",
            storyIndexParse: "解析故事大纲",
            storyDocumentRead: "读取故事脚本",
            storyDocumentParse: "解析故事脚本",
            interfaceDocumentRead: "读取界面文档",
            charactersRead: "读取人物",
            pluginLoad: "加载插件",
            pluginHostLoad: "加载插件系统",
        },
    },
    // 撤销 / 重做。`scope` 是某一条撤销栈的名字（"在<这里>撤销"），`entry` 是栈上的一步，
    // 也就是菜单项或提示要说"将要撤销什么"时用的那句。
    history: {
        scope: {
            storyScene: "场景",
            storyMotion: "运动",
            audioLoop: "音频标记",
            uiSurface: "界面",
            blueprint: "蓝图",
            project: "工程",
        },
        menu: {
            undoNamed: "撤销{step}",
            redoNamed: "重做{step}",
        },
        entry: {
            edit: "编辑",
            storyEdit: "故事编辑",
            storyMotionEdit: "运动编辑",
            audioMarkers: "标记变更",
            surfaceEdit: "界面编辑",
            blueprintEdit: "蓝图编辑",
            replaceText: "文本替换",
        },
    },
    shell: {
        errorTitle: "工作区初始化失败",
        showStackTrace: "显示堆栈跟踪",
        retry: "重试",
        openOtherProject: "打开其他项目",
        errorCopyDetails: "复制详情",
        errorCopied: "错误详情已复制到剪贴板",
        errorCopyFailed: "复制失败：{error}",
        errorExportLogs: "导出日志",
        errorExported: "日志已保存到 {path}",
        errorExportFailed: "导出日志失败：{error}",
        errorOpenFailed: "无法打开该文件夹：{error}",
        notAProjectTitle: "此文件夹不是 NarraLeaf 项目",
        notAProjectDetail: "未找到 .nlproj 文件",
        openLauncher: "打开启动器",
        panelRenderError: "此面板渲染时出错",
        mainEditorRegion: "主编辑器",
        resizeSplit: "调整分屏比例",
        noActiveEditor: "没有活动的编辑器",
        closePanel: "关闭面板",
        closeTab: "关闭 {name}",
        newTab: "新建标签页",
        // 标签条"+"打开的浏览器式空白标签页。
        newTabPage: {
            title: "新标签页",
        },
        tabMenu: {
            close: "关闭",
            closeOthers: "关闭其他",
            closeToRight: "关闭右侧标签",
            closeAll: "全部关闭",
            splitRight: "向右拆分",
            splitDown: "向下拆分",
            closeSplit: "关闭拆分",
            reopenClosed: "重新打开关闭的标签",
        },
        toggleLeftSidebar: "切换左侧边栏",
        toggleRightSidebar: "切换右侧边栏",
        toggleBottomPanel: "切换底部面板",
        panelMenu: {
            removeItem: "移除此项目",
            collapseItem: "折叠到折叠项",
        },
        // 左侧导轨的折叠项：一个图标代表被折叠进去的面板，点击后在导轨旁展开列表。
        panelGroup: {
            title: "折叠项",
        },
        openSettings: "打开设置",
        stopDevMode: "停止开发模式",
        stopPreview: "停止预览",
        logoAlt: "NarraLeaf Studio 徽标",
        editorTabsLabel: "编辑器标签页",
        // 可搜索的命令面板（Cmd/Ctrl+Shift+P）：把所有动作、菜单命令与带说明的快捷键汇成一个列表，随输入过滤。
        commandPalette: {
            title: "命令面板",
            placeholder: "输入命令…",
            empty: "没有匹配的命令",
            // 空态提示行：点击切换到命令模式（填入 ">"）。
            goToCommands: "显示并运行命令",
            // 「打开 X 面板」这类导航命令显示的分类。
            categoryView: "视图",
            // 编辑器标签命令的分类与标题（作用于当前活动标签）。
            categoryEditor: "编辑器",
            // 没有声明分类的命令用它兜底（浏览模式按分类分组）。
            categoryOther: "其他",
            categoryGo: "跳转",
            categoryStory: "剧情",
            categoryRun: "运行",
            categoryProject: "项目",
            categoryPreferences: "偏好设置",
            // 版本控制命令的分类（冻结，以及后续的提交、历史）。
            categoryVersionControl: "版本控制",
            editor: {
                closeTab: "关闭标签页",
                closeSelectedTabs: "关闭选中的标签页",
                closeOthers: "关闭其他标签页",
                closeToRight: "关闭右侧标签页",
                closeAll: "关闭全部标签页",
                splitRight: "向右拆分编辑器",
                splitDown: "向下拆分编辑器",
                closeOtherGroups: "关闭其他编辑器组",
            },
        },
        // 通知中心（控制栏铃铛；所有 toast 的环形历史）。
        notifications: {
            title: "通知",
            clearAll: "清空",
            empty: "还没有消息",
        },
        // 自定义背景对话框（从设置或命令面板打开）。
        background: {
            command: "设置背景图像…",
            title: "背景图像",
            image: "图像",
            imagePlaceholder: "未选择图像",
            browse: "浏览…",
            opacity: "不透明度",
            blur: "模糊",
            // 值为 0 时代替像素读数显示，此时滤镜完全关闭。
            blurOff: "关闭",
            fillMode: "填充方式",
            anchor: "位置",
            fill: {
                cover: "缩放填满",
                contain: "适应",
                tile: "平铺",
                center: "居中",
            },
            cancel: "取消",
            clear: "清除并关闭",
            apply: "完成",
        },
        // 快速打开（mod+p）：可打开实体的模糊选择器。
        quickOpen: {
            title: "快速打开",
            placeholder: "跳转到场景、角色、界面、素材、蓝图…",
            empty: "没有匹配项",
            kinds: {
                scene: "场景",
                character: "角色",
                uiSurface: "界面",
                asset: "素材",
                blueprint: "蓝图",
            },
        },
        // 底部状态条。各信号只在有意义时出现（运行中/构建中/未保存）。
        statusBar: {
            // 统一「运行状态」单元格的模式名称，格式为「模式 | 阶段」，任一模式运行时整条状态栏都会染成主题色。
            devMode: "开发模式",
            preview: "预览",
            production: "生产构建",
            // 分隔符之后的阶段文案。并非每个阶段都适用于每种模式。
            phase: {
                starting: "启动中…",
                preparing: "准备中…",
                compiling: "编译中…",
                launching: "启动中…",
                packaging: "打包中…",
                running: "运行中",
                reloading: "重载中…",
                stopping: "停止中…",
            },
            openConsole: "打开控制台",
            unsavedChanges: "未保存的更改",
            saveNow: "立即保存",
            saving: "保存中…",
            saveFailed: "保存失败",
            retrySave: "立即重试保存",
            resetZoom: "重置缩放到 100%",
            shortcuts: "快捷键速查",
            words: "{count} 字",
            lines: "{count} 行",
            noStoryOpen: "未打开故事",
            openDashboard: "打开项目仪表盘",
            openCurrentScene: "打开当前场景",
            // 已注册状态栏项目的名称，仅在状态栏右键开关菜单中显示。
            entries: {
                runStatus: "运行状态",
                unsavedChanges: "未保存的更改",
                wordCount: "故事统计",
                shortcuts: "快捷键速查",
                notifications: "通知",
                theme: "主题切换",
                zoom: "缩放比例",
                version: "版本",
                textFileName: "文本文件名",
                textEncoding: "文本编码",
                textLineEnding: "行尾符号",
                textSelection: "光标位置",
            },
        },
        // 保存反馈：文件写不进去时弹出的常驻提示，以及「存储」控制台频道的日志行。
        // 失败的写入会按退避阶梯一直重试、永不放弃，所以文案说的是「仍在重试」而不是「已丢失」。
        save: {
            failedTitle: "无法保存 {file}",
            failedDetailTransient: "正在后台继续重试；{error}",
            failedDetailPermanent: "在此问题修复之前重试无效；{error}",
            retry: "立即重试",
            consoleFailed: "写入失败（{code}，第 {attempt} 次尝试）：{path} · {error}",
            consoleRecovered: "写入成功：{path}",
            flushFailed: "{label} 刷盘失败：{error}",
            // 读取侧：文件在盘上，但读不懂。文案先说「没发生什么」——这时作者最怕的是「Studio 把我的东西吃了」。
            unreadableTitle: "无法读取 {file}",
            unreadableDetail: "{reason} 文件保持原样，没有内容被覆盖",
            unreadableDetailQuarantined: "{reason} 文件保持原样，其副本已保存在 {path}",
            consoleUnreadable: "读取失败（{kind}）：{path} · {reason}",
            consoleQuarantined: "已保留无法读取的文件副本：{path}",
            // 因工作区冻结而被拒绝的写入。这不是失败：没有出错，也不会重试。文案必须说清原因，
            // 否则读起来就是个 bug。
            frozenTitle: "当前不保存任何改动",
            frozenDetailRevision: "当前正在查看版本 {version}，查看期间的改动不会保存",
            frozenDetailManual: "工作区已冻结，解除冻结后恢复保存",
            // 合并没有「解除冻结」这一步：工作树里同时放着两边，只有把合并做完才行。
            frozenDetailMerge: "有一次合并尚未完成，在版本面板中完成合并后恢复保存",
            consoleFrozen: "写入被拒绝，工作区已冻结（{reason}）：{path}",
            // 持有项目数据的各方名称：刷盘失败时用，重读工作树失败时也用。
            stores: {
                uiDocument: "界面文档",
                uiGraph: "界面蓝图",
                story: "故事",
                localization: "本地化",
                voice: "语音库",
                variables: "变量注册表",
                audioTracks: "音频轨道",
                appTags: "变体",
                brand: "配色方案",
                dictionary: "工程词典",
                saveSchema: "存档字段",
                characters: "角色",
                project: "项目设置",
                assets: "资产库",
            },
        },
        // 重读工作树：磁盘上的内容不再是编辑器显示的内容（解除冻结、恢复版本）。正常情况下作者
        // 什么都不该看到——只有某一部分读不回来时才出声，因为那时面板里是旧内容。
        reload: {
            failedTitle: "项目未完整重新读取",
            failedDetail: "以下内容仍显示重读之前的内容：{stores}；重新打开项目以再次读取",
            console: "已从磁盘重读项目（{cause}）：{count} 项",
            consoleFailed: "无法重读 {label}：{error}",
        },
        // 冻结工作区：项目数据停止写入，编辑器状态照常。命名按作者能感知的效果（「停止保存」）来，
        // 而不是按机制来。
        spellcheck: {
            addToDictionary: "加入工程词典",
            noSuggestions: "没有候选词",
        },
        freeze: {
            command: "冻结项目（停止保存改动）",
            release: "解除冻结（恢复保存改动）",
            enteredTitle: "项目已冻结",
            enteredDetail: "解除冻结之前，项目文件不会被写入",
            leftTitle: "已解除冻结",
            leftDetail: "改动会重新写入项目",
            // 顶栏中被冻结关掉的每一个控件的悬浮提示。故意所有控件共用一句：作者只需要认一次
            // 「冻结的项目就是这个样子」，而不是在每个按钮上读一套不同的说辞。控件是禁用而不是
            // 隐藏，正是为了给这句话留一个可悬浮的落点。
            unavailable: "项目冻结期间不可用，解除冻结后恢复使用",
        },
        // 用真编辑器浏览历史，在版本轨道做出来之前的入口。故意只做「上一个版本」而不是选择器：
        // 选版本需要一份列表，那份列表就是轨道本身；而一个人手上够不着的里程碑没法验收。
        revisionView: {
            showPrevious: "查看上一个版本（只读）",
            // 按它「离开的模式」命名，而不是按它「去到的地方」命名，见 docs/help-system.md §4。
            leave: "退出历史查看",
            loadingTitle: "正在读取上一个版本…",
            loadingDetail: "首次读取某个版本可能需要从远端取回",
            shownTitle: "正在查看版本 {revision}",
            shownDetail: "编辑器为只读，磁盘上的文件不会被改动",
            noneTitle: "没有更早的版本",
            noneDetail: "该项目只有一个版本",
            failedTitle: "无法显示该版本",
        },
        // 版本控制的三个界面：最左侧的版本轨道、项目切换器菜单里的版本那一段、状态栏那一位。三者一律只说
        // 「哪个版本」，绝不显示变更数——数变更要扫描，而扫描不是纯读（docs/version-control.md §4.17）。
        versionControl: {
            title: "版本",
            open: "打开版本轨道",
            // 同一个按钮两种文案，因为它做两件事：冻结期间面板折回 48px 常驻条（那条必须留着，它是
            // 出口），而在 HEAD 上没有常驻条，关掉就什么都不剩。那时写「折叠」等于承诺一列作者随后
            // 找不到的东西。
            collapse: "折叠版本轨道",
            close: "关闭版本轨道",
            // 正在看历史版本时，折叠轨道、切换器菜单与状态栏那一位的悬停文案。`{version}` 是该版本自己的
            // 标签，例如 `#4`。
            viewingVersion: "正在查看版本 {version}",
            currentVersion: "当前版本",
            // 逃生口，也是它为什么在轨道的两种状态下都在：让作者卡在一个出不去的冻结工作区里，
            // 是这个功能能造成的最坏结果。
            //
            // 按它「离开的模式」命名（docs/help-system.md §4）。原文案「回到当前版本」说的是仓库那边
            // 发生了什么，而它就摆在一个真的会覆盖工程的按钮旁边、顶着一个逆时针箭头，读起来像
            // 「把我的工程退回去」。现在这个说法读不出那层意思：它停掉的只有「查看」。
            returnToCurrent: "退出历史查看",
            returning: "正在退出历史查看…",
            // 整个界面里唯一会改动作者磁盘文件的动作，下面三句话是它与「工作没了」之间唯一的东西。
            //
            // 动作自己说出自己是什么，而不是写「恢复」：确认框会把这句话放在按钮上，而一句
            // 「确定」摆在一段讲覆盖文件的话旁边，正是一个人按错东西的方式。
            restore: "恢复到这个版本",
            // 明说是哪个版本，免得这个框被当成在问另一个——作者是从一列版本里点进来的。
            // `{version}` 是 `#12`，若进入时没带标签则是短哈希。
            restoreConfirm: "恢复到版本 {version}？",
            // 两句话，一句都不能少。第一句是作者要同意的事；第二句是同意它为什么安全，少了它
            // 就是把一个可回退的操作演成不可逆的，而一个被当成不可逆的功能没人敢用。
            // 「先记录」是字面意思：检查点在写下第一个字节之前就提交，而检查点打不出来时整个
            // 恢复直接中止。
            restoreConfirmDetail: "项目文件会被替换为该版本的内容；当前状态会先记录为一个检查点，不会删除任何版本",
            // 很慢：一次检查点、重写每一个受版本控制的文件、再提交一个版本，然后跟「回到当前
            // 版本」一样整体重读一遍。
            restoring: "正在恢复到这个版本…",
            // 恢复唯一一种「失败时文件已经换过了」的失败：重写已经做完，只有提交它的那一次没成。
            // 先说他的项目现在是什么样，再说错误——因为作者本来会得出的结论「失败了所以什么都没
            // 发生」正好与事实相反，然后他就在一个悄悄退回上周的项目上继续干活。`{action}` 是
            // 「提交版本」那个按钮，从按钮自己的文案取，免得这句话指向一个已经改了名的控件。
            restoreNotRecordedTitle: "文件已恢复，但该版本未能提交",
            restoreNotRecordedDetail:
                "项目文件现在是版本 {version} 的内容；将其提交为新版本时失败（{error}）；"
                + "按「{action}」可以重新提交",
            // 还没有版本库的项目。按「缺什么」命名，而不是按机制命名。
            //
            // 原文案是「没有版本历史」，与下面的 `noHistory`（仓库存在但还没有版本）几乎撞车。
            // 这一条说的是「这个工程根本没纳入版本控制」，所以改成与下面按钮 `enable` 对齐的说法。
            notVersioned: "未启用版本控制",
            enable: "启用版本控制",
            // 只有一行：启用会往作者的项目目录里写东西并对它取独占锁，所以在他按下之前先说清做什么。
            // 用「保存」而不是「记录」：这句说的是将来会有的历史，不是那个动作——而在一个已经写着
            // 「提交版本」的按钮下面留着最后一处「记录」，读起来就是同一件事有两个名字。
            enableHint: "在这个项目的目录里保存版本历史",
            enabling: "正在设置版本控制…",
            // 仓库已经存在、里面还没有版本——与上面的 `notVersioned`（压根没启用）是两回事。
            noHistory: "还没有版本",
            history: "历史",
            loadingHistory: "正在读取版本历史…",
            // 列表末尾，只在这次读取是「读满了上限」而不是「读到工程开头」时出现。说的是作者能得到
            // 什么，而不是怎么取的——「加载更多」描述的是机制，而那个机制（用更大的上限重读一遍）
            // 不该是他们需要知道的事。
            loadMoreHistory: "显示更早的版本",
            // 配了远端的项目首次读取某个版本会走网络，所以这是真的在等，不是礼貌性的转圈。
            loadingRevision: "正在打开该版本…",
            showVersion: "在编辑器里显示这个版本",
            // 有一个以上父级的版本。标记而不是展开：轨道是线性列表，而不加标记的合并会让这个
            // 线性列表说假话。
            merge: "合并",
            changes: "变更",
            refreshChanges: "检查变更",
            // 提交一个版本的按钮。写「提交版本」而不是「提交更改」：这一整块说的都是「版本」，
            // 作者交出去的就是一个版本。用「提交」而不是「记录」，是因为将来的远端 lore 服务器
            // 会把同一个动作叫「提交」——词现在就定死，免得以后一半界面一个说法。
            commit: "提交版本",
            // 是个问句而不是命令，并且明说可选——因为它确实可选：不写消息也是一个合法的版本，
            // 没有消息的版本会在上面的列表里用自己的编号称呼自己。
            commitPlaceholder: "这次改了什么？（可选）",
            commitMessage: "版本说明",
            authorLabel: "提交版本记录的作者",
            authorPlaceholder: "作者名",
            authorSave: "保存",
            // 绝不是瞬时的：管线要先把这个窗口没保存的东西落完，再暂存整个工程，然后等后端把它的
            // store 写到磁盘上。
            committing: "正在提交这个版本…",
            // 「还没人看过」，这和「干净」不是一回事——而这个区别很重要，因为「看」就是一次扫描，
            // 这个界面绝不自己发起。
            nothingToCommit: "自上个版本以来没有变更",
            closingWithApp: "Studio 正在关闭，重启后再试",
            changesUnknown: "未检查",
            noChanges: "没有变更",
            changesCount: "{count} 项变更",
            // 逐文件清单。每一行都只是展示：看一个文件「里面」改了什么是后面的里程碑，而一个点开
            // 什么都没有的行，正是这个面板一直小心不去许下的承诺。
            //
            // 每行那个记号的含义。后端本身没有「修改」这个动作——改过内容的文件报的是 KEEP
            // （docs §4.18），是出口处翻译过来的——所以这五个词是 Studio 的词汇，作者永远看不到
            // 后端的那套。
            changeKind: {
                added: "新增",
                modified: "修改",
                deleted: "删除",
                moved: "移动",
                copied: "复制",
            },
            // 移动或复制的来源。`{path}` 和行本身一样是仓库相对路径。
            changeFromPath: "来自 {path}",
            // 唯一一种会挡住「提交版本」的变更——所以它被单独标出来，也因此排在清单最前面，
            // 而不是按路径落在它本来的位置上。
            changeConflict: "未解决的冲突",
            // 清单有上限。这件事要说出来：一个悄悄停在第五十条的列表会被读成「一共就这些」，
            // 作者会以为自己看全了要提交的东西，然后就提交了。
            changesMore: "还有 {count} 项未显示",
            // 检查点是 Studio 按计时器记下的；写一天下来会有几十个。
            command: {
                openRail: "打开版本控制",
                commit: "提交版本",
                refreshChanges: "检查变更",
                compareChanges: "与上一个版本比较变更",
            },
            filterPlaceholder: "按名称或编号查找版本",
            filterNoMatch: "已读取的 {count} 个版本里没有匹配",
            today: "今天",
            yesterday: "昨天",
            compareBase: {
                set: "让其他版本与这个版本比较",
                clear: "不再与这个版本比较",
                current: "正在与 {version} 比较",
                compare: "与 {version} 比较",
            },
            showCheckpoints: "显示 {count} 个检查点",
            hideCheckpoints: "隐藏检查点",
            systemMessage: {
                unnamed: "未命名的版本",
                enabled: "已启用版本控制",
                created: "已创建工程",
                merge: "合并",
                checkpoint: "检查点",
                checkpointClose: "关闭工程前的检查点",
                checkpointBuild: "构建前的检查点",
                checkpointRestore: "还原前的检查点",
                restored: "还原到 {version}",
            },
            // 版本控制是**可选能力**——Epic 不为 macOS Intel 与 Windows ARM64 提供原生后端——所以
            // 这两句话不一样，因为作者只有其中一种情况能自己动手。两者都不渲染成禁用控件：在那些
            // 机器上这个功能从未发货，灰掉的轨道会把一台好机器说成装坏了。
            unavailable: {
                platform: "本机不支持版本控制",
                installation: "当前 Studio 安装不包含版本控制",
            },
            // 版本轨道里的服务器区。用「服务器」不用「远端」：没用过版本控制的作者知道服务器是什么，
            // 而「远端」这个词要先懂模型才有意义。
            server: {
                title: "服务器",
                // 没连服务器——在有人明确说要连之前，每个工程都是这个状态。
                none: "没有连接服务器",
                connect: "连接服务器",
                picker: {
                    title: "连接服务器",
                    nameLabel: "在服务器上的名称",
                    namePlaceholder: "my-game",
                    empty: "尚未添加服务器",
                    // 列表的最后一行。省略号是「会打开别处」的既有写法：它打开设置并关闭本对话框。
                    add: "添加服务器…",
                    manual: "其他地址",
                },
                // 只有这一个字段。实测：后端只保留 URL 的**源**，仓库靠它自己的 id 认，
                // 所以真的没有第二样东西要填——旁边不需要「仓库名」。
                addressLabel: "服务器地址",
                addressPlaceholder: "lore://studio.example.lan:41337",
                save: "连接",
                cancel: "取消",
                disconnect: "断开连接",
                // 够到服务器最多要两秒，所以它永远不会自己发生——面板打开时是「还没查」，
                // 由这个按钮去问。
                check: "检查服务器",
                checking: "正在检查服务器…",
                notChecked: "未检查",
                upToDate: "已是最新",
                // 故意按「版本」数而不是按文件数：作者提交的是版本，
                // 而决定要不要推送的，正是有多少个版本还没离开这台机器。
                localAhead: "本地有未上传到服务器的版本",
                remoteAhead: "服务器上有本地没有的版本",
                // 两边都动过。这种状态下推送会被拒绝并说明原因，先同步就会合并。
                diverged: "本地和服务器都有新版本",
                unreachable: "无法连接该服务器",
                // 服务器答应了但不接受我们。**只有这个状态**才显示凭据字段——
                // 在没有人被拒绝之前就问令牌，是在问一个多数作者永远不需要回答的问题。
                unauthorized: "该服务器拒绝了访问",
                push: "上传到服务器",
                pushing: "正在上传到服务器…",
                // 「已经有了」是成功。按两次是很正常的事。
                pushedAlready: "服务器上已有这些版本",
                sync: "从服务器获取",
                syncing: "正在从服务器获取版本…",
                syncedNothing: "已是最新",
                signIn: {
                    required: "这台服务器要求先登录，然后才能把项目指向它。",
                    open: "登录此服务器",
                    signedInAs: "已登录为 {name}",
                    signOut: "退出登录",
                    addressLabel: "登录地址",
                    addressPlaceholder: "https://studio.example.lan:41402",
                    tokenLabel: "访问令牌",
                    tokenPlaceholder: "粘贴你拿到的令牌",
                    hint: "令牌由服务器的管理者签发并交给你。",
                    trust: {
                        open: "在这台电脑上信任该服务器",
                        title: "信任该服务器？",
                        vouched: "你粘贴的令牌点名了这个证书发放机构，在那个地址上应答的也正是它。",
                        compare: "请通过这条连接以外的途径，与服务器管理者给你的指纹核对。",
                        authorityLabel: "颁发者",
                        fingerprintLabel: "指纹",
                        meaning: "持有该机构密钥的任何一方，都能为任意地址签发证书，而这个账户都会相信。受影响的只有这台电脑上的这个账户。",
                        manual: "这个系统没有按账户的信任库，Studio 无法代劳。请运行下面这条命令，然后重新登录：",
                        copy: "复制命令",
                        confirm: "信任",
                        cancel: "取消",
                    },
                    submit: "登录",
                    cancel: "取消",
                    reach: {
                        ready: "此服务器与这份 Studio 可以协同工作。",
                        notPermitted: "已登录，但该账号尚未获得此项目的访问权。请向服务器的管理者申请。",
                        dataPortSilent: "已登录，但服务器本身没有响应。",
                    },
                    problem: {
                        scheme: "登录地址必须以 https:// 或 ucs-auth:// 开头。",
                        token: "这不是此服务器签发的令牌。请粘贴你拿到的完整令牌。",
                        address: "这个令牌没有写明去哪里登录，所以还需要地址。",
                        certificate:
                            "这台电脑尚未被告知信任此服务器所用的证书颁发机构。它的指纹是 {fingerprint}。",
                        mismatch:
                            "那个地址上的服务器不是这个令牌对应的那一台。令牌点名的是 {expected}，"
                            + "应答的却是 {found}。不要信任它，请向服务器的管理者核实。",
                        unreachable: "该地址没有任何响应（{detail}）。",
                        refused: "服务器不接受该令牌（{detail}）。",
                        unknown: "登录未能完成（{detail}）。",
                    },
                },
            },
            // 同步时合不拢的文件。用常驻通知而不是行内错误：同步在收尾时会离开版本视图，
            // 而轨道会因为这个状态变化重新读一遍，行内错误在有人看见之前就被清掉了。
            //
            // 说的是「接下来去哪」而不是「发生了什么」：同步只报告然后停下，不会把作者
            // 直接拖进解决界面——和「绝不替作者建仓库」是同一条纪律。
            syncConflictTitle: "部分文件无法合并",
            syncConflictDetailOne:
                "有一个文件在本地和服务器上都被修改过：\n"
                + "{files}\n"
                + "其余改动已合并；在版本面板中选择每个文件保留哪一边",
            syncConflictDetailMany:
                "有 {count} 个文件在本地和服务器上都被修改过：\n"
                + "{files}\n"
                + "其余改动已合并；在版本面板中选择每个文件保留哪一边",
            // 合并进行中，只在真的有合并时出现——那时它就是面板里最要紧的一块。
            mergeOpen: "合并进行中",
            mergeConflicts: {
                one: "有 {count} 个文件要选保留哪一边",
                other: "有 {count} 个文件要选保留哪一边",
            },
            // 自动合并全都合上了，只差记一个版本。
            mergeNoConflicts: "全部内容已自动合并，提交一个版本即可完成",
            mergeResolve: "完成合并",
        },
        // 快捷键自定义（设置 tab）+「?」速查浮层。
        keybindings: {
            searchPlaceholder: "搜索快捷键…",
            hint: "点击快捷键即可录制新组合，Esc 取消",
            record: "录制快捷键",
            recording: "按下新的快捷键…",
            reset: "恢复默认",
            resetAll: "全部重置",
            customized: "已自定义",
            conflict: "与「{name}」冲突",
            empty: "没有匹配的快捷键",
            openSettings: "自定义快捷键",
            cheatSheetTitle: "快捷键速查",
            cheatSheetCustomize: "自定义…",
            // 设置表与速查表的分类标题（来自静态目录）。
            categories: {
                general: "通用",
                story: "故事编辑器",
                uiEditor: "UI 编辑器",
                blueprint: "蓝图编辑器",
                storyMotion: "故事动效",
                assets: "素材",
                other: "其他",
            },
            // 此前没有自带 i18n key 的目录条目标签。
            catalog: {
                commandPalette: "显示并运行命令",
                quickOpen: "快速打开",
                cheatSheet: "显示快捷键速查",
                contextHelp: "当前位置的帮助",
                reopenClosedTab: "重新打开关闭的标签",
                undo: "撤销",
                redo: "重做",
                quickSwitchNext: "切换到下一个编辑器标签",
                quickSwitchPrevious: "切换到上一个编辑器标签",
                uiEditor: {
                    undo: "撤销",
                    redo: "重做",
                    copy: "复制",
                    cut: "剪切",
                    paste: "粘贴",
                    duplicate: "创建副本",
                    group: "编组",
                    ungroup: "取消编组",
                    selectAll: "全选",
                    delete: "删除所选",
                    rename: "重命名",
                    escape: "关闭菜单 / 退出编辑",
                    alignLeft: "左对齐",
                    alignHorizontalCenter: "水平居中",
                    alignRight: "右对齐",
                    alignTop: "顶端对齐",
                    alignVerticalCenter: "垂直居中",
                    alignBottom: "底端对齐",
                    distributeHorizontal: "水平等距",
                    distributeVertical: "垂直等距",
                },
                blueprint: {
                    undo: "撤销",
                    redo: "重做",
                    copy: "复制节点",
                    cut: "剪切节点",
                    paste: "粘贴节点",
                },
                storyMotion: {
                    undo: "撤销",
                    redo: "重做",
                    delete: "删除关键帧",
                    prevFrame: "播放头后退一帧",
                    nextFrame: "播放头前进一帧",
                    prevFrames: "播放头后退十帧",
                    nextFrames: "播放头前进十帧",
                    playheadStart: "播放头移到开头",
                    playheadEnd: "播放头移到结尾",
                },
            },
        },
        // 全局项目搜索：dock 面板与命令面板搜索模式共用。
        search: {
            placeholder: "搜索项目…",
            // 顶栏搜索 pill 上的文案（点击后打开搜索模式的命令面板）。`{name}` 为当前项目名。
            titleBarPlaceholder: "在 {name} 中搜索",
            building: "正在建立搜索索引…",
            idle: "可搜索场景、角色、剧情文本、资源与蓝图",
            empty: "没有匹配结果",
            more: "还有 {count} 条",
            // 与场景查找栏共用的三个匹配开关，同一条查询在两处含义一致。
            caseSensitive: "区分大小写",
            wholeWord: "全词匹配",
            regex: "使用正则表达式",
            invalidPattern: "表达式无效",
            // 全工程替换剧情正文。按钮上的数字是匹配次数，不是行数，也不是列表里显示的条数。
            // 开关行末尾那个展开替换行的按钮。搜索是常事，所以面板默认只有搜索框。
            toggleReplace: "替换",
            replacePlaceholder: "替换为",
            replaceAll: "替换全部",
            replaceRow: "替换这一行",
            // 计划里要改的东西已经被删掉或改过了。替换要么整体生效，要么什么都不做，所以这里直接拒绝。
            replaceStale: "工程刚刚变过，请重新搜索",
            // 实体分组排在前面：这个框先回答「打开叫 X 的东西」，再回答「找到写着 X 的那句」。
            groups: {
                scene: "场景",
                story: "剧本",
                character: "角色",
                uiSurface: "UI 界面",
                blueprint: "蓝图",
                asset: "素材",
                storyText: "剧情文本",
                variable: "变量",
                uiTextKey: "UI 文本 Key",
                blueprintNode: "蓝图节点",
            },
            // 一行结果代表多条一模一样的结果时，行尾显示的角标。
            occurrences: "×{count}",
        },
        // 标题栏里类 PyCharm 的项目选择器：显示当前项目名，下拉列出最近工作区。
        // 从这里选的项目既可以换到当前窗口，也可以另开一个窗口，所以文案说的是「打开」不是「切换」，
        // 由 `openTarget` 那个对话框问清楚。
        projectSwitcher: {
            openAnother: "打开其他项目",
            recentProjects: "最近项目",
            current: "当前",
            openProject: "打开项目…",
            newProject: "新建项目…",
            noRecent: "无最近工作区",
            untitled: "未命名项目",
            // 选中项目之后、真正打开之前问的一句。对话框已经写出选中的项目，
            // 这行说的是当前窗口里那个项目会怎么样，也是按钮上说不出来的部分。
            openTarget: {
                title: "打开项目",
                detail: "在当前窗口打开会关闭「{current}」，未保存的更改会自动保存",
                thisWindow: "在当前窗口打开",
                newWindow: "在新窗口打开",
            },
        },
        closeConfirm: {
            message: "关闭当前工作区？",
            detail: "未保存的更改会自动保存",
        },
        // 关闭过程中工作区自己说的话，一个阶段一句（见 `WorkspaceCloseStage`）。
        // 真正花时间的是检查点那一步，也正是需要点名说清楚的那一步。
        closing: {
            title: "正在关闭工作区",
            saving: "正在保存更改…",
            checkpoint: "正在记录项目的检查点…",
            launcher: "正在返回启动器…",
        },
        // 打开过程中的同一件事，一个阶段一句（见 `WorkspaceStartupStage`）。
        // 说的是作者在等什么，而不是内部在构造什么。
        opening: {
            title: "正在打开工作区",
            preparing: "正在打开项目…",
            services: "正在载入项目内容…",
            interface: "正在准备编辑器…",
        },
    },
} satisfies LocaleNamespace<"workspace">;
