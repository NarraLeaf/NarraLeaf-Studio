/** `storyInspector` - the per-action-type inspector in the story scene editor. */
export const storyInspector = {
    // The disclosure that hides this line's translation/voice unit id. The id itself is a uuid, so
    // the label names what it is FOR rather than what it is.
    textId: "Localization key",
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
        voice: "Voice",
        // Names the scope the camera has, which no field can: the pose outlives the scene.
        camera: "Camera · story-wide",
        // Says the scope no field can: an overlay sits above the whole stage, not inside a layer.
        vfx: "Ambience · full-screen overlay",
    },

    voice: {
        voiced: "Voiced",
        none: "No take",
        stale: "Outdated",
        openTable: "Open voice table",
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
        axis: "Axis",
        blades: "Blades",
        fromAngle: "From angle °",
        rows: "Rows",
        cols: "Columns",
        stagger: "Stagger",
        shape: "Shape",
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
        barnDoor: "Barn door",
        clock: "Clock",
        fan: "Fan",
        dots: "Dots",
        slide: "Push",
        throughColor: "Through color",
        darkness: "Darkness",
        startX: "Start X",
        startY: "Start Y",
        blurPx: "Blur px",
        holdPct: "Hold %",
        darknessFrom: "From darkness 0-1",
        darknessTo: "To darkness 0-1",
    },

    transitionHint: {
        dissolve: "Crossfades from the previous image to the new one.",
        blurDissolve: "Crossfades while blurring, a dreamy flashback / dream-state dissolve.",
        fadeIn: "Fades the new image in from a start position offset.",
        maskCircle: "Circular reveal / close driven by an animated mask radius.",
        softIris: "Feathered circular reveal, the soft-edged counterpart of Mask circle.",
        maskWipe: "Hard-edged directional reveal. The new image is uncovered by a sweeping straight edge (no feather).",
        softWipe: "Feathered directional wipe. The new image erases in with a soft gradient edge.",
        blinds: "Venetian blinds reveal. Slats widen to uncover the new image.",
        barnDoor: "Barn doors. Two soft edges close from opposite sides toward the centre.",
        clock: "Clock wipe. A radial edge sweeps a full turn around the centre.",
        fan: "Fan / windmill. Several blades sweep in parallel around the centre.",
        dots: "Polka dots. A grid of dots grows until the cells flood together.",
        slide: "Push. The new image slides in from one edge as the old one slides out.",
        darkness: "Darkness. Swaps to the new image at the starting darkness and animates its brightness to the ending one - 1 → 0 emerges out of black, 0 → 1 dims into it.",
        throughColor: "Covers the frame with a solid colour (using the chosen pattern), holds, then uncovers on the new image. The target appears only after the colour hold. Covers fade-to-black/white, soft wipe through black, blinds black hold, iris to black, and flash (hold 0).",
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

    clockDirection: {
        clockwise: "Clockwise",
        counterclockwise: "Counter-clockwise",
    },

    irisShape: {
        circle: "Circle",
        ellipse: "Ellipse",
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

    vfxOperation: {
        pause: "Freeze",
        resume: "Continue",
        setRate: "Set speed",
    },

    // Named by the material each mode is FOR, not by the CSS keyword: the choice is a production fact
    // about the clip, and the keyword alone only helps someone who already knows the answer.
    vfxBlend: {
        normal: "Normal — transparent clip (alpha WebM)",
        screen: "Screen — glow on black",
        multiply: "Multiply — shadow on white",
        lighten: "Lighten",
        colorDodge: "Color dodge",
        overlay: "Overlay",
    },

    vfxFit: {
        cover: "Cover",
        contain: "Contain",
        fill: "Fill",
    },

    vfx: {
        name: "Effect name",
        clip: "Looping clip",
        blendMode: "Blend",
        opacity: "Opacity (0-1)",
        fit: "Fit",
        zIndex: "Z-index",
        loop: "Loop",
        rate: "Speed (1 = normal)",
        fade: "Fade (s)",
    },

    cameraOperation: {
        zoom: "Zoom",
        pan: "Pan",
        rotate: "Rotate",
        // "stage", not "screen": this is the camera's brightness, not `/vignette`'s in-scene mask.
        darken: "Darken stage",
        reset: "Reset camera",
    },

    camera: {
        zoom: "Zoom (1 = neutral)",
        rotation: "Rotation °",
        darkness: "Stage darkness (0-1)",
        xalign: "X align (0-1)",
        yalign: "Y align (0-1)",
    },

    displayableOperation: {
        transform: "Transform",
        mask: "Mask",
        clearMask: "Clear mask",
        clip: "Clip path",
        clearClip: "Clear clip",
        filter: "Filter",
        clearFilter: "Clear filter",
        backdrop: "Backdrop",
        blend: "Blend mode",
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
        backdrop: "Frosts what shows through via CSS backdrop-filter (e.g. blur(8px)).",
        blend: "Blends with what is behind via mix-blend-mode.",
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
        // "Play" waits for the clip to finish before the story continues; "Resume" does not.
        play: "Play (wait for end)",
        pause: "Pause",
        resume: "Resume",
        stop: "Stop",
        seek: "Seek to",
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
        seekTime: "Seek to",
    },

    nvl: {
        hint: "Child rows run inside NLR NVL mode. The transform below animates the NVL layer as it enters.",
        motionLabel: "NVL enter animation",
    },

    character: {
        // The handle later rows use to reach this character — `/move Nattou`, `/hide Nattou`. Named
        // for what the author does with it; "stage name" was the engine's word for the object.
        objectName: "Refer to as",
        // Named for what the player reads, not for the field it writes: this is the speaker label from
        // this row on, which is what makes "？？？" become a name.
        displayName: "Speaks as",
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
        backdropFilter: "CSS backdrop-filter",
        blendMode: "Blend mode",
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
        labelName: "Label name",
        gotoTarget: "Go to label",
        noLabels: "No labels in this scene",
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
        brokenExpression: "This expression no longer resolves - a variable it reads may have been renamed or deleted. The branch evaluates false until it is fixed.",
        clear: "Clear condition",
    },

    code: {
        language: "Language",
        source: "Source",
    },

    declaration: {
        name: "Name",
        type: "Type",
        default: "Default",
        description: "Description",
    },
} as const;
