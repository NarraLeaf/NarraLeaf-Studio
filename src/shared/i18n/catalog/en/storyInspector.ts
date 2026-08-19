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
        rule: "Rule image",
        inverted: "From the bright end",
        stagger: "Stagger",
        shape: "Shape",
        pattern: "Pattern",
        kind: "Kind",
        effect: "Effect",
        character: "Character",
        // A blink's two halves, named for what each one does. Empty means "follow the whole move".
        // Only a blink has them: the engine drives a vignette's fade in and out from one duration.
        closeIn: "Close (s)",
        openOut: "Open (s)",
        vignetteInner: "Clear center %",
        vignetteOuter: "Dark edge %",
        layer: "Layer",
        muted: "Muted",
    },

    motionTarget: {
        image: "Image",
        text: "Text",
        layer: "Layer",
        character: "Character",
        displayable: "Displayable",
        camera: "Stage camera",
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
        flip: "Flip",
        circleReveal: "Circle reveal",
        circleClose: "Circle close",
        slideReveal: "Slide reveal",
        custom: "Custom",
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
        exposure: "Exposure",
        ruleReveal: "Rule image",
        exposureEv: "Exposure (EV)",
        exposureLift: "Shadow lift 0-1",
        startX: "Start X",
        startY: "Start Y",
        blurPx: "Blur px",
        holdPct: "Hold %",
        darknessFrom: "From darkness 0-1",
        darknessTo: "To darkness 0-1",
    },

    transitionHint: {
        dissolve: "Crossfades from the previous image to the new one.",
        blurDissolve: "Crossfades while blurring, for flashbacks and dream states.",
        fadeIn: "Fades the new image in from a start position offset.",
        maskCircle: "A hard-edged circle opens or closes over the frame.",
        softIris: "The same circle with a feathered edge.",
        maskWipe: "A straight edge sweeps across, uncovering the new image.",
        softWipe: "The same sweep with a soft gradient edge.",
        blinds: "Slats widen to uncover the new image.",
        barnDoor: "Two soft edges close from opposite sides toward the centre.",
        clock: "A radial edge sweeps a full turn around the centre.",
        fan: "Several blades sweep in parallel around the centre.",
        dots: "A grid of dots grows until the cells flood together.",
        slide: "The new image slides in from one edge as the old one slides out.",
        darkness: "Swaps images at the starting darkness, then animates to the ending one. 1 → 0 emerges out of black, 0 → 1 dims into it.",
        throughColor: "Covers the frame with a color, holds, then uncovers on the new image. Use it for fade to black or white, iris to black, and flash (hold 0).",
        exposure: "Burns the frame out to white, highlights first and shadows last, then settles back down onto the new one; at lift 0 black never whitens.",
        ruleReveal: "Changes the frame over in the order a greyscale picture dictates: dark areas first, bright areas last.",
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
        normal: "Normal (transparent alpha WebM)",
        screen: "Screen (glow on black)",
        multiply: "Multiply (shadow on white)",
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
        // "Grade", the word the craft uses, so the picker teaches the vocabulary rather than only the token.
        look: "Color grade",
        motion: "Camera motion",
        reset: "Reset camera",
    },

    // The picker labels: short enough that they fit side by side. The full names above stay as each
    // button's tooltip, so `Darken stage` still gets to say *stage* where it matters.
    cameraOperationShort: {
        zoom: "Zoom",
        pan: "Pan",
        rotate: "Rotate",
        darken: "Darken",
        look: "Grade",
        motion: "Motion",
        reset: "Reset",
    },

    camera: {
        zoom: "Zoom (1 = neutral)",
        rotation: "Rotation °",
        darkness: "Stage darkness (0-1)",
        xalign: "X align (0-1)",
        yalign: "Y align (0-1)",
        look: "Look",
        lookSnaps: "A look lands in a single frame. Fading one would walk the picture through colours nobody chose, so there is no duration to set — cut into it behind a blink or a transition.",
        lookIntensity: "Intensity (1 = nominal)",
        lookFilter: "Custom CSS filter",
    },

    // The looks themselves. Named for the moment they are for, not for what they do to the pixels:
    // an author reaches for these while writing a flashback, not while thinking about saturation.
    cameraLook: {
        memory: "Memory",
        monologue: "Inner monologue",
        mono: "Monochrome",
        moonlight: "Moonlight",
        faint: "Losing consciousness",
        hangover: "Hangover",
    },

    cameraLookHint: {
        channel: "A look replaces stage darkness rather than adding to it — the engine gives both the same filter, so the later row wins. Each look carries its own brightness. Reset camera clears it.",
        monologue: "Desaturates and dims the whole stage. For darkened edges, add a vignette.",
        hangover: "The stage sways twice before the look settles. The row waits for the sway, and the duration sets its tempo.",
    },

    /**
     * The transform channel list - the words that are not already a command param.
     *
     * Every channel names itself with `story.paramHint.*`, so only what the line has no word for
     * lands here: the clip-path generators, the restore entry's frame, and the list's own controls.
     */
    transformChannel: {
        reveal: "Reveal",
        search: "Search effects",
        noMatch: "No effect matches",
        inherit: "Inherit",
        maskSettings: "Mask settings",
        maskSize: "Size",
        maskPosition: "Position",
        maskRepeat: "Repeat",
        maskMode: "Mode",
        clipShape: {
            inset: "Rectangle",
            circle: "Circle",
            ellipse: "Ellipse",
            raw: "Custom path",
        },
        clipParam: {
            top: "Top %",
            right: "Right %",
            bottom: "Bottom %",
            left: "Left %",
            radius: "Radius %",
            radiusX: "Radius X %",
            radiusY: "Radius Y %",
            x: "Centre X %",
            y: "Centre Y %",
        },
        restore: "Restore {channel}",
        restored: "Restored",
        add: "Add",
        remove: "Remove",
        xAlign: "X",
        yAlign: "Y",
    },
    transformChannelGroup: {
        geometry: "Position and scale",
        filter: "Filter",
        look: "Look",
        composite: "Compositing",
        text: "Text",
        timing: "Timing",
    },
    displayableOperation: {
        transform: "Transform",
        bringToFront: "Bring to front",
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
        backdrop: "Frosts what shows through. Takes a filter value, such as blur(8px).",
        blend: "Blends with what is behind via mix-blend-mode.",
        darken: "Fades a darkness overlay 0..1 (image / character targets only).",
        circleReveal: "Circular reveal via an animated mask.",
        circleClose: "Circular close via an animated mask.",
        wipe: "Hard-edged directional reveal, with no feather.",
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
        seekSound: "Seek",
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
        hint: "Leave the condition empty to always show and enable this option.",
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
        track: "Track",
        // The name of the track an unset reference lands on, so the empty choice is not a blank.
        trackDefault: "Default ({name})",
        soundName: "Sound name",
        bgmAsset: "BGM asset",
        soundAsset: "Sound asset",
        fade: "Fade (s)",
        seekTime: "Seek to (s)",
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
        hint: "Child rows run in NVL mode. The transform below animates the NVL layer as it enters.",
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
        // A character its own runtime draws: the names come from the model, so these fields are filled
        // from what the model reported about itself, and empty is a request (clear it) rather than an
        // unfilled slot - which is why each channel names what clearing it looks like.
        puppetMotion: "Motion",
        puppetExpression: "Expression",
        puppetSkin: "Skin",
        puppetNone: "none",
        puppetSkinDefault: "model default",
        puppetParams: "Parameters",
        puppetParamId: "Parameter",
        puppetParamValue: "Value",
        puppetParamAdd: "Add parameter",
        puppetParamRemove: "Remove parameter",
        puppetNoParams: "This row sets no parameters yet.",
        notPuppetHint: "This character is drawn by Studio, so it has no runtime state to set.",
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
        loopKind: "Loop",
        loopKindTimes: "A number of times",
        loopKindUntil: "Until a condition",
        until: "Stop when",
        // Spells out the two things the token itself does not: it is a STOP condition, and it is
        // tested before the body, so a condition already true means the group never runs.
        untilHint: "The group repeats while this is false and stops when it becomes true. The condition is checked before each pass.",
        breakHint: "Leaves the repeat group containing this row. It has no effect outside a repeat group.",
        cutVariant: "Build variant",
        cutHint: "This build ends at this line and contains nothing after it. Every other build is unchanged and does not contain this line.",
        // The row still names a variant the project no longer has. It reads the release values like
        // every other stranded reference, and a cut point on the release build ends nothing.
        cutMissingVariant: "Deleted variant, now read as {name}",
        cutNoVariants: "No variants",
        branch: "Branch",
        elseHint: "Else branch runs when previous branches do not match.",
    },

    condition: {
        brokenExpression: "This expression no longer resolves. A variable it reads may have been renamed or deleted. The branch stays false until the expression is fixed.",
        clear: "Clear condition",
    },

    declaration: {
        name: "Name",
        type: "Type",
        default: "Default",
        description: "Description",
    },
} as const;
