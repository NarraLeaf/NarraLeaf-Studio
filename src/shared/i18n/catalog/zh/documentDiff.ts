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
     * 素材：不读内容，只读文件头。
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
        other: "已改动，但概要无法说明具体改动",
    },
    structural: {
        property: "{name}",
        element: "第 {index} 项",
        root: "文档本身",
    },
    count: {
        assets: "素材",
        audioTracks: "音轨",
        brandColors: "配色",
        characterGroups: "角色分组",
        characters: "角色",
        localizationKeys: "本地化键",
        storyBlocks: "故事行",
        storyChapters: "章节",
        storyScenes: "场景",
        translationUnits: "译文",
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
    assets: {
        added: "新增素材",
        removed: "删除素材",
        changed: "素材改动",
        renamed: "改名",
        content: "文件内容已替换",
        field: "{field} 改动",
    },
    tier: {
        summary: "仅概要",
        summaryHint: "没有比较内容本身，这些是两个版本各自报告的数字",
        structural: "结构级",
        structuralHint: "仅按 JSON 结构比较，所以生成的 id 和重排过的数组都会被算成改动",
        opaque: "未读取",
        opaqueHint: "文件过大、非文本或无法读取，只能报告体积",
    },
    rows: {
        loading: "正在读取差异…",
        empty: "该文件内部没有差异",
        // 三种「空」。「已修改」配上「没有差异」读起来是自相矛盾，而每一档能给出的
        // 说法强度不一样，理由见 documentDiffEmptyKey。
        emptyFormatting: "只有格式变了",
        emptyUntracked: "编辑器记录的内容没有变化",
        emptyCounts: "总数没有变化",
        notInspected: "该文件未被查看",
        moreInGroup: "另有 {count} 处",
        viewAll: "查看全部 {count} 处",
        showing: "已显示 {shown} / {total}",
    },
    rail: {
        expand: "展开内部改动",
        collapse: "收起内部改动",
        compareWithPrevious: "与上一个版本对比",
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
        readFailure: "无法读取本次对比所需的数据：{error}",
        incomplete: "{total} 条变更路径里比较了 {shown} 条，其余被略过",
        documentsOmitted: "另有 {count} 个文件没有列出",
        unavailable: "该工程没有可用的版本控制",
    },
    /**
     * 整份取一边地收尾一次合并。
     *
     * 用词是「保留我的／保留对方的」而不是后端的 mine/theirs：按下「从服务器获取」的作者
     * 是在跟同伴的改动对齐，不是在做三路合并。
     *
     * `notSaved` 是这整个界面之所以诚实的那一句——哪些冲突已经决定过，没有任何地方读得出来，
     * 所以这份记录只属于这个窗口；说出来，好过暗示一份关掉标签页就没了的进度。
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
        finish: "完成合并",
        finishUndecided: {
            one: "还有 {count} 个文件没选边",
            other: "还有 {count} 个文件没选边",
        },
        notSaved: "这些选择仅在本窗口打开期间有效；按下完成之前不会写入任何文件",
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
} satisfies LocaleNamespace<"documentDiff">;
