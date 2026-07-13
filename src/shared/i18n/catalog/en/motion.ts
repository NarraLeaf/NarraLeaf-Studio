/** `motion` — the Story Motion editor: motion assets, timeline, keyframes, easing, and stage preview. */
export const motion = {
    storyMotion: "Story Motion",
    editMotion: "Edit motion",
    clearMotion: "Clear motion",
    fallbackLabel: "Motion",
    searchStoryMotions: "Search story motions",
    property: "Property",

    targetKind: {
        image: "Image",
        character: "Character",
        text: "Text",
        layer: "Layer",
    },

    templates: {
        fadeInSlide: "Fade in + slide",
        centerPop: "Center pop",
        lookAround: "Look around",
        flash: "Flash",
    },

    selector: {
        emptyKind: "No {kind} motions yet. Use “New” to create one.",
        loadingPreview: "Loading preview…",
    },

    field: {
        motionAsset: "Motion asset",
        choosePlaceholder: "Choose motion…",
    },

    panel: {
        searchPlaceholder: "Search motions",
        createMotion: "Create motion",
        empty: "No motions.",
        newMotion: "New Motion",
        motionActions: "Motion actions",
        repeat: "Repeat",
        repeatDelayMs: "Repeat delay ms",
        actionUses: "Current action uses {id}",
        actionNoMotion: "Current action has no motion asset",
        bindToAction: "Bind to action",
        target: "Target",
        background: "Background",
        previewTarget: "Preview target",
        previewBackground: "Preview background",
        previewTargetTitle: "Preview target image (editor only)",
        previewBackgroundTitle: "Preview background image (editor only)",
        selectOrCreate: "Select or create a story motion.",
        deleteConfirm: "Delete motion \"{name}\"?",
        deleteDetail: "This removes the motion asset and closes related editors.",
        clearAria: "Clear {name}",
    },

    editor: {
        loading: "Loading motion asset…",
        assetDeleted: "Motion asset was deleted.",
        play: "Play",
        pause: "Pause",
        animatedProperties: "Animated properties",
        addProperty: "Add property",
        addKeyframeAtPlayhead: "Add keyframe at playhead",
        addKeyframeAria: "Add {property} keyframe at playhead",
        deleteTrack: "Delete track",
        deleteTrackAria: "Delete {property} track",
    },

    keyframe: {
        loading: "Loading keyframe…",
        keyframeActions: "Keyframe actions",
        motionLabel: "Motion",
        time: "Time",
        timeMs: "Time ms",
        easing: "Easing",
        easingDefault: "Default",
        easingCustom: "Custom",
        value: "Value",
        xAlign: "X align",
        yAlign: "Y align",
        xOffset: "X offset",
        yOffset: "Y offset",
        deleteKeyframe: "Delete keyframe",
    },

    picker: {
        change: "Change",
        choose: "Choose",
        assetFallback: "Asset {id}",
        noMotionBound: "No motion is bound to this action.",
        noMatches: "No matching story motions.",
        previewKind: "Preview: {kind}",
    },

    preview: {
        stageLabel: "Stage preview",
        dragZoom: "Drag to zoom",
        dragScaleX: "Drag to scale X",
        dragScaleY: "Drag to scale Y",
        dragRotate: "Drag to rotate",
    },
} as const;
