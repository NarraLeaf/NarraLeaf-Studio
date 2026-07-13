import type { LocaleNamespace } from "../types";

export const assets = {
    loading: "正在加载素材…",
    loadError: "加载素材失败",
    searchPlaceholder: "搜索素材…",
    searchTooltip: "搜索素材",
    closeSearch: "关闭搜索",
    clearSearch: "清除搜索",
    backToParent: "返回上级分组",
    importRemote: "远程导入",
    noTags: "无标签",
    preview: "预览",
    emptyType: "还没有{label}",
    itemCount: {
        other: "{count} 项",
    },
    view: {
        list: "列表视图",
        icons: "图标视图",
    },
    filter: {
        label: "筛选",
    },
    actions: {
        copyTooltip: "复制选中的素材或分组",
        cutTooltip: "剪切选中的素材或分组",
        pasteTooltip: "粘贴素材或分组",
        deleteTooltip: "删除选中的素材或分组",
    },
    search: {
        noResults: "未找到匹配的素材",
        matchTag: "标签：{tag}",
        resultCount: {
            other: "{count} 条结果",
        },
    },
    list: {
        emptyFiltered: "没有符合当前筛选的素材。",
    },
    iconView: {
        updating: "正在更新…",
        assetCount: {
            other: "{count} 个素材",
        },
        tagCount: {
            other: "+{count} 个标签",
        },
    },
    menu: {
        newGroup: "新建分组",
        newSubGroup: "新建子分组",
        importAssets: "导入素材…",
        copyCount: {
            other: "复制 {count} 项",
        },
        cutCount: {
            other: "剪切 {count} 项",
        },
        deleteCount: {
            other: "删除 {count} 项",
        },
    },
    selector: {
        selectType: "选择{type}",
        importFromDisk: "从磁盘导入",
        noAssets: "没有符合当前筛选的素材",
        selectedCount: "已选 {count} 项",
        choose: "选择",
    },
    cropper: {
        title: "裁剪图片",
        reload: "重新加载",
        loadError: "无法加载图片",
        selection: "选区：{width}×{height}",
        waiting: "等待选择选区…",
    },
    magicTag: {
        title: "创建标签",
        detectedDelimiters: "检测到的分隔符",
        regexPattern: "正则表达式",
        captureGroups: "捕获组：{groups}",
        categoryMapping: "标签类别映射",
        exampleFilename: "示例文件名：{filename}",
        categoryPlaceholder: "标签类别（例如：char、emo）",
        moreFiles: "…还有 {count} 个文件",
        summary: "将为 {files} 个文件共添加 {tags} 个标签",
        applying: "正在应用…",
        applyTags: "应用标签",
    },
    audio: {
        play: "播放",
        pause: "暂停",
        mute: "静音",
        unmute: "取消静音",
        seek: "跳转",
        volume: "音量",
        playback: "播放控制",
        loading: "正在加载音频…",
        loadError: "加载音频失败",
        channelCount: {
            other: "{count} 声道",
        },
    },
    image: {
        loading: "正在加载图片…",
        loadError: "加载图片失败",
        zoomIn: "放大",
        zoomOut: "缩小",
        resetView: "重置视图",
    },
} satisfies LocaleNamespace<"assets">;
