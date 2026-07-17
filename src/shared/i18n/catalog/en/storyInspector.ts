/** `storyInspector` — the per-action-type inspector in the story scene editor. */
export const storyInspector = {
    closeEditor: "Close editor",
    noEditableFields: "No editable fields for this action yet.",
    textId: "Text ID",
    advanced: "Advanced",
    advancedParams: "Advanced params",
    noVariablesDeclared: "No variables declared",
    unassigned: "Unassigned",

    section: {
        timing: "Timing",
        conditions: "Conditions",
        appearance: "Appearance",
        blueprint: "Blueprint",
        effect: "Effect",
        transform: "Transform",
        transition: "Transition",
    },

    field: {
        operation: "Operation",
        value: "Value",
        valueJson: "Value (JSON)",
        scope: "Scope",
        variable: "Variable",
        mode: "Mode",
        duration: "Duration (s)",
        hold: "Hold (s)",
        easing: "Easing",
        color: "Color",
        opacity: "Opacity",
        center: "Center",
        fromRadius: "From radius",
        toRadius: "To radius",
        direction: "Direction",
        reverse: "Reverse",
        feather: "Feather %",
        orientation: "Orientation",
        slats: "Slats",
        pattern: "Pattern",
        kind: "Kind",
        effect: "Effect",
        character: "Character",
        layer: "Layer",
        muted: "Muted",
    },

    motionTarget: {
        image: "Image",
        text: "Text",
        layer: "Layer",
        character: "Character",
        displayable: "Displayable",
    },

    variableScope: {
        scene: "Scene",
        saved: "Saved",
        persistent: "Persistent",
    },

    transformPreset: {
        left: "Left",
        center: "Center",
        right: "Right",
        fadeIn: "Fade in",
        fadeOut: "Fade out",
        slideLeft: "Slide left",
        slideRight: "Slide right",
        slideUp: "Slide up",
        slideDown: "Slide down",
        zoom: "Zoom",
        scale: "Scale",
        rotate: "Rotate",
        opacity: "Opacity",
        darken: "Darken",
        circleReveal: "Circle reveal",
        circleClose: "Circle close",
        slideReveal: "Slide reveal",
    },

    easing: {
        default: "Default",
        linear: "Linear",
        easeIn: "Ease in",
        easeOut: "Ease out",
        easeInOut: "Ease in/out",
        circIn: "Circ in",
        circOut: "Circ out",
        circInOut: "Circ in/out",
        backIn: "Back in",
        backOut: "Back out",
        backInOut: "Back in/out",
        anticipate: "Anticipate",
    },

    transition: {
        dissolve: "Dissolve",
        blurDissolve: "Blur dissolve",
        fadeIn: "Fade in",
        maskCircle: "Mask circle",
        softIris: "Soft iris",
        maskWipe: "Slide reveal",
        softWipe: "Soft wipe",
        blinds: "Blinds",
        slide: "Push",
        throughColor: "Through color",
        startX: "Start X",
        startY: "Start Y",
        blurPx: "Blur px",
        holdPct: "Hold %",
    },

    transitionHint: {
        dissolve: "Crossfades from the previous image to the new one.",
        blurDissolve: "Crossfades while blurring — a dreamy flashback / dream-state dissolve.",
        fadeIn: "Fades the new image in from a start position offset.",
        maskCircle: "Circular reveal / close driven by an animated mask radius.",
        softIris: "Feathered circular reveal — the soft-edged counterpart of Mask circle.",
        maskWipe: "Hard-edged directional reveal — the new image is uncovered by a sweeping straight edge (no feather).",
        softWipe: "Feathered directional wipe — the new image erases in with a soft gradient edge.",
        blinds: "Venetian blinds reveal — slats widen to uncover the new image.",
        slide: "Push — the new image slides in from one edge as the old one slides out.",
        throughColor: "Covers the frame with a solid colour (using the chosen pattern), holds, then uncovers on the new image — the target appears only after the colour hold. Covers fade-to-black/white, soft wipe through black, blinds black hold, iris to black, and flash (hold 0).",
    },

    wipeDirection: {
        left: "Left",
        right: "Right",
        top: "Top",
        bottom: "Bottom",
    },

    blindsOrientation: {
        horizontal: "Horizontal",
        vertical: "Vertical",
    },

    throughColorPattern: {
        plain: "Plain (fade)",
        linear: "Soft edge",
        blinds: "Blinds",
        iris: "Iris",
    },

    imageOperation: {
        create: "Create / update",
        setSource: "Set source",
    },

    displayableOperation: {
        transform: "Transform",
        mask: "Mask",
        clearMask: "Clear mask",
        clip: "Clip path",
        clearClip: "Clear clip",
        filter: "Filter",
        clearFilter: "Clear filter",
        darken: "Darken",
        circleReveal: "Circle reveal",
        circleClose: "Circle close",
        wipe: "Slide reveal",
    },

    displayableEffectHint: {
        mask: "Applies an image asset as a CSS mask.",
        clearMask: "Removes the current mask.",
        clip: "Applies a CSS clip-path.",
        clearClip: "Removes the current clip-path.",
        filter: "Applies a CSS filter (e.g. blur(4px) grayscale(1)).",
        clearFilter: "Removes the current filter.",
        darken: "Fades a darkness overlay 0..1 (image / character targets only).",
        circleReveal: "Circular reveal via an animated mask.",
        circleClose: "Circular close via an animated mask.",
        wipe: "Hard-edged directional reveal via an animated clip-path (no feather).",
    },

    textOperation: {
        create: "Create / update",
        setText: "Set text",
        setFontSize: "Set font size",
        setFontColor: "Set font color",
    },

    layerOperation: {
        setZIndex: "Set z-index",
    },

    videoOperation: {
        play: "Play",
    },

    audioOperation: {
        setBgm: "Set BGM",
        playSound: "Play sound",
        stopSound: "Stop sound",
        pauseSound: "Pause sound",
        resumeSound: "Resume sound",
        setVolume: "Set volume",
        setRate: "Set rate",
        muteSound: "Mute / unmute",
    },

    screenEffectOption: {
        blink: "Blink",
        vignette: "Vignette",
    },

    waitMode: {
        duration: "Duration",
        click: "Click",
    },

    branch: {
        if: "If",
        elseIf: "Else if",
        else: "Else",
    },

    narration: {
        editHint: "Double-click the row to edit narration text.",
    },

    dialogue: {
        pauseAfter: "Pause after line",
        pauseSeconds: "Pause (s, optional)",
    },

    choice: {
        prompt: "Prompt",
    },

    choiceOption: {
        optionText: "Option text",
        hiddenWhen: "Hidden when",
        disabledWhen: "Disabled when",
        hint: "Leave a condition untouched to always show / enable this option.",
    },

    jump: {
        targetScene: "Target scene",
    },

    note: {
        label: "Note",
    },

    blueprint: {
        storyActionTitle: "Story Action",
    },

    audio: {
        soundName: "Sound name",
        bgmAsset: "BGM asset",
        soundAsset: "Sound asset",
        fade: "Fade (s)",
        volume: "Volume",
        rate: "Rate",
        loop: "Loop",
    },

    image: {
        imageName: "Image name",
        imageAsset: "Image asset",
        autoFit: "Auto fit",
    },

    text: {
        textName: "Text name",
        fontSize: "Font size",
        fontColor: "Font color",
        text: "Text",
    },

    layer: {
        layerName: "Layer name",
        zIndex: "Z-index",
    },

    video: {
        videoName: "Video name",
        videoAsset: "Video asset",
    },

    nvl: {
        hint: "Child rows run inside NLR NVL mode. The transform below animates the NVL layer as it enters.",
        motionLabel: "NVL enter animation",
    },

    character: {
        stageName: "Stage name",
        chooseHint: "Choose a character to pick its appearance.",
        overrideImage: "Override image",
    },

    asset: {
        missing: "Missing asset",
        none: "No asset",
        clear: "Clear asset",
        selectTitle: "Select {label}",
    },

    displayableEffect: {
        maskImage: "Mask image",
        clipPath: "Clip path",
        cssFilter: "CSS filter",
        darkness: "Darkness 0-1",
    },

    transform: {
        presetMode: "Preset",
        motionMode: "Motion",
        preset: "Preset",
        zoom: "Zoom",
        xOffset: "X offset",
        yOffset: "Y offset",
        params: "Params",
    },

    background: {
        image: "Image",
        color: "Color",
        missing: "Missing image",
        none: "No image",
        change: "Change",
        select: "Select",
        clearImage: "Clear image",
        assetError: "Image asset could not be resolved: {error}",
        selectImageTitle: "Select Background Image",
    },

    control: {
        conditionContainer: "Condition container. Add condition branches as children.",
        control: "Control",
        sequence: "Sequence",
        parallel: "Parallel all",
        race: "Race any",
        repeat: "Repeat",
        mode: {
            do: "Do",
            doAsync: "Do async",
            all: "All",
            allAsync: "All async",
            any: "Any",
        },
        times: "Times",
        branch: "Branch",
        elseHint: "Else branch runs when previous branches do not match.",
    },

    condition: {
        legacyExpression: "Legacy expression conditions are preserved in the document but are not part of the NLR action surface.",
        clear: "Clear condition",
    },

    code: {
        language: "Language",
        source: "Source",
    },
} as const;
