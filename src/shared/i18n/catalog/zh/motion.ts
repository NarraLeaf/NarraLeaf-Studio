import type { LocaleNamespace } from "../types";

export const motion = {
    storyMotion: "故事动画",
    editMotion: "编辑动画",
    clearMotion: "清除动画",
    fallbackLabel: "动画",
    searchStoryMotions: "搜索故事动画",
    property: "属性",

    targetKind: {
        image: "图像",
        character: "角色",
        text: "文本",
        layer: "图层",
    },

    templates: {
        fadeInSlide: "淡入 + 滑入",
        centerPop: "居中弹出",
        lookAround: "环视",
        flash: "闪烁",
    },

    selector: {
        emptyKind: "还没有{kind}动画，点击“新建”创建一个。",
        loadingPreview: "正在加载预览…",
    },

    field: {
        motionAsset: "动画资源",
        choosePlaceholder: "选择动画…",
    },

    panel: {
        searchPlaceholder: "搜索动画",
        createMotion: "创建动画",
        empty: "暂无动画。",
        newMotion: "新建动画",
        motionActions: "动画操作",
        repeat: "重复次数",
        repeatDelayMs: "重复延迟（毫秒）",
        actionUses: "当前动作使用 {id}",
        actionNoMotion: "当前动作未绑定动画资源",
        bindToAction: "绑定到动作",
        target: "目标",
        background: "背景",
        previewTarget: "预览目标",
        previewBackground: "预览背景",
        previewTargetTitle: "预览目标图片（仅编辑器）",
        previewBackgroundTitle: "预览背景图片（仅编辑器）",
        selectOrCreate: "选择或创建一个故事动画。",
        deleteConfirm: "删除动画“{name}”？",
        deleteDetail: "此操作将移除该动画资源并关闭相关编辑器。",
        clearAria: "清除{name}",
    },

    editor: {
        loading: "正在加载动画资源…",
        assetDeleted: "动画资源已被删除。",
        play: "播放",
        pause: "暂停",
        animatedProperties: "动画属性",
        addProperty: "添加属性",
        addKeyframeAtPlayhead: "在播放头处添加关键帧",
        addKeyframeAria: "在播放头处添加{property}关键帧",
        deleteTrack: "删除轨道",
        deleteTrackAria: "删除{property}轨道",
    },

    keyframe: {
        loading: "正在加载关键帧…",
        keyframeActions: "关键帧操作",
        motionLabel: "动画",
        time: "时间",
        timeMs: "时间（毫秒）",
        easing: "缓动",
        easingDefault: "默认",
        easingCustom: "自定义",
        value: "值",
        xAlign: "X 对齐",
        yAlign: "Y 对齐",
        xOffset: "X 偏移",
        yOffset: "Y 偏移",
        deleteKeyframe: "删除关键帧",
    },

    picker: {
        change: "更换",
        choose: "选择",
        assetFallback: "资源 {id}",
        noMotionBound: "此动作未绑定动画。",
        noMatches: "没有匹配的故事动画。",
        previewKind: "预览：{kind}",
    },

    preview: {
        stageLabel: "舞台预览",
        dragZoom: "拖动以缩放",
        dragScaleX: "拖动以横向缩放",
        dragScaleY: "拖动以纵向缩放",
        dragRotate: "拖动以旋转",
    },
} satisfies LocaleNamespace<"motion">;
