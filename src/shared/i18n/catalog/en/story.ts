/** `story` - the story panel (library/outline) plus the scene editor: prose/dialogue
 *  rows, rich-text toolbar, character/layer/target pickers, pause & interpolation
 *  popovers, and the live preview pane. */
export const story = {
    panel: {
        storiesCount: "Stories ({count})",
        newStory: "New Story",
        emptyStories: "No stories in this project.",
        storyActions: "Story actions",
        setDefault: "Set Default",
        outline: "Outline",
        newChapter: "New Chapter",
        newSceneInChapter: "New Scene in Chapter",
        loadingStory: "Loading story…",
        chapterTitle: "{name} ({count})",
        emptyScenes: "No scenes.",
        lineCount: {
            one: "{count} line",
            other: "{count} lines",
        },
        sceneActions: "Scene actions",
        chapterActions: "Chapter actions",
        setEntryScene: "Set as Entry Scene",
        documentUnavailable: "Story document unavailable.",
        newStoryPlaceholder: "Enter story name",
        newChapterPlaceholder: "Enter chapter name",
        newSceneTitle: "New Scene",
        newScenePlaceholder: "Enter scene name",
        deleteStoryConfirm: "Delete story \"{name}\"?",
        deleteStoryDetail: "This removes the story document from the project.",
        deleteChapterConfirm: "Delete chapter \"{name}\"?",
        // Counted, because the row does not say what is inside it until it is expanded — and the
        // scenes go with the chapter.
        deleteChapterDetail: {
            one: "Its {count} scene is deleted with it.",
            other: "Its {count} scenes are deleted with it.",
        },
        deleteSceneConfirm: "Delete scene \"{name}\"?",
        deleteSceneDetail: "This removes the scene and its blocks. Jumps to it will stop resolving.",
    },
    // Taking a scene out of Studio as a text file and bringing it back. `parseError` and `diag` are
    // keyed by the codec's own codes (see `storyScriptTypes`), so a new code fails the parity test
    // rather than reaching an author as a raw identifier.
    script: {
        exportScene: "Export as Script…",
        exportStory: "Export Story as Script…",
        import: "Import Script…",
        exportTitle: "Export as Script",
        exportAction: "Export",
        mode: {
            roundtrip: "Round-trip",
            roundtripDetail: "Carries the scene's data, so the file can be imported back.",
            review: "Review",
            reviewDetail: "Prose only. Cannot be imported.",
        },
        exported: "Exported to {path}",
        importTitle: "Import Script",
        importAction: "Import",
        imported: {
            one: "Imported {count} scene",
            other: "Imported {count} scenes",
        },
        nothingToImport: "This file carries no scene.",
        storyMismatch: "This file was exported from a different story.",
        stale: "This scene changed after the export; importing discards those changes.",
        sceneMissing: "This scene is no longer in the story, so it is skipped.",
        // Undo is per open scene editor, so a multi-scene import can be undoable in part.
        noUndo: "Importing from here cannot be undone.",
        noUndoSome: {
            one: "{count} of these scenes cannot be undone after importing.",
            other: "{count} of these scenes cannot be undone after importing.",
        },
        // Both failure paths state what happened to the project, because "an error occurred" leaves an
        // author unable to tell a refused import from a half-written one.
        planFailed: "This script could not be prepared for import. Nothing was changed.",
        importFailed: "Import stopped at \"{scene}\": {applied} of {total} scenes were written, the rest were left unchanged.",
        line: "Line {line}",
        stat: {
            unchanged: "{count} unchanged",
            edited: "{count} edited",
            added: "{count} added",
            removed: "{count} removed",
            cloned: "{count} cloned",
            moved: "{count} moved",
        },
        parseError: {
            notAScript: "This file is not a story script.",
            unsupportedVersion: "This script was written by a newer version of Studio.",
            dataMissing: "This script carries no scene data, so it cannot be imported. Review exports are read-only.",
            dataCorrupt: "This script's scene data is damaged and cannot be read.",
            malformed: "This script could not be read.",
        },
        diag: {
            opaqueWithoutAnchor: "An action line lost its marker, so the action could not be restored.",
            unknownAnchor: "A marker names a row this script does not carry.",
            shapeMismatchAction: "An action line was rewritten as prose; the action was kept and the edit dropped.",
            shapeMismatchText: "A text line was rewritten as an action line; the text was kept and the edit dropped.",
            duplicateAnchor: "A line was copied; the copies were given new identities.",
            unknownRun: "A formatting marker names formatting this script does not carry.",
            unplaceableLine: "A new line cannot be placed here.",
            speakerUnresolved: "This line binds no character, so the original speaker name was kept. Its text still changed.",
        },
    },
    // The NarraLang export: the story as a script, for reading and comparing. One-way, so a row the
    // script cannot say is reported rather than refused and the file is written either way. `reason`
    // is keyed by the printer's own codes (see `narralangPrinter`), so a new code fails the parity
    // test rather than reaching an author as a raw identifier.
    narralang: {
        exportScene: "Export as NarraLang…",
        exportStory: "Export Story as NarraLang…",
        sceneMissing: "This scene is no longer in the story.",
        reportTitle: "Rows without a script form",
        reportSummary: {
            one: "{count} row has no script form. The file does not carry it in full.",
            other: "{count} rows have no script form. The file does not carry them in full.",
        },
        unresolvedRefNamed: "This row points at {what} that no longer exists.",
        detail: {
            asset: "an asset",
            character: "a character",
            appearance: "an appearance",
            motion: "a motion",
            scene: "a scene",
            variable: "a variable",
            variant: "a build variant",
            camera: "a camera position",
            // Read back as well as printed: a script that names a stage object nothing created is a
            // parse failure, and these are the two nouns that failure comes back with.
            displayable: "something on stage",
            layer: "a layer",
        },
        reason: {
            blueprintAction: "A blueprint runs this row, and a blueprint has no script form.",
            blueprintCondition: "A blueprint decides this condition.",
            blueprintInterpolation: "A blueprint computes a value inside this text.",
            inlineEvent: "The text carries an event that fires while it is being typed out.",
            invalidRow: "This row's command could not be read, so it is written as it stands.",
            customTransform: "This movement is set frame by frame, or carries properties the script does not name.",
            customTransition: "This transition carries properties the script does not name.",
            effectProps: "This effect carries properties the script does not name.",
            unresolvedRef: "This row points at something that no longer exists.",
            unknownPayload: "This row is of a kind the script does not cover.",
        },
        // Why a line of a script could not be read back into the scene. Keyed by the parser's own
        // codes and fenced by `narralangIo.test.ts` the same way `reason` is, so a new code fails a
        // test rather than reaching an author as a raw identifier. Separate from `reason` because
        // they answer different questions - that one is "why can this row not be written down", this
        // one is "why can this line not be read".
        parse: {
            unknownStatement: "This line starts with a keyword and does not read as that statement.",
            unknownName: "This line names something the project does not have.",
            unknownNameNamed: "This line names {what} the project does not have.",
            ambiguousName: "Several things have this name, so it cannot be told which was meant.",
            ambiguousNameNamed: "Several things have this name, so it cannot be told which {what} was meant.",
            ambiguousStatement: "Several statements fit this line and cannot be told apart.",
            badWord: "This statement does not accept this word here.",
            missingValue: "This statement is missing a required value.",
            conflictingValues: "This line sets the same thing twice, in two different ways.",
            badIndent: "This line is indented by part of a level, or skips one.",
            danglingBranch: "This branch has no condition above it.",
            badTag: "This line carries a formatting tag that is unknown, or left open.",
            badExpression: "This expression does not resolve.",
        },
        // The scene read and written as a script inside the editor. Editable for a scene the script
        // can say in full; read-only for good for one it cannot - which is the whole job of `gate`:
        // an author who is told "not yet" plans differently from one told "not ever".
        view: {
            open: "Read as a script",
            close: "Back to rows",
            readOnly: "This scene has rows with no script form, so it cannot be written here.",
            gate: {
                one: "{count} row has no script form, so this scene will not become editable here.",
                other: "{count} rows have no script form, so this scene will not become editable here.",
            },
            // The one thing the marked lines cannot say for themselves: that nothing has been
            // written. Stated, not instructed - the marks already say which lines and why.
            unread: {
                one: "{count} line cannot be read. The scene is unchanged.",
                other: "{count} lines cannot be read. The scene is unchanged.",
            },
            // The header was read and not obeyed. A script cannot rename a scene: the name is what
            // the outline and every jump address it by, and a rename arriving as a side effect of
            // typing would have no undo the author could find. Saying nothing would be worse - they
            // would believe it had worked.
            renameElsewhere: "The scene name was not changed. Rename the scene in the outline.",
        },
    },
    // Pasting a wall of prose into a scene. The wizard asks one question — who is speaking — and
    // remembers the answer per project, so chapter two opens with chapter one's decisions filled in.
    paste: {
        title: "Paste as Rows",
        action: "Paste",
        totals: "{dialogue} dialogue · {narration} narration · {created} new characters",
        lineCount: {
            one: "{count} line",
            other: "{count} lines",
        },
        moreRows: {
            one: "…and {count} more row",
            other: "…and {count} more rows",
        },
        noSpeakers: "No speaker labels; every line becomes narration.",
        targetFor: "Who {label} is",
        willBeCreated: "Will be created",
        separator: {
            none: "No speakers",
            colon: "Name: text",
            fullwidthColon: "Name：text",
            dash: "Name — text",
            lenticular: "【Name】text",
            cornerBracket: "「Name」text",
            tab: "Name ⇥ text",
            regex: "Custom",
        },
        regexPlaceholder: "^(?<speaker>[^:]+):\\s*(?<text>.+)$",
        problem: {
            invalidRegex: "This pattern is not valid yet.",
            missingGroups: "The pattern needs both a (?<speaker>…) and a (?<text>…) group.",
        },
        presetNamePlaceholder: "Name this separator",
        savePreset: "Save",
        forgetPreset: "Forget this preset",
        target: {
            tempSpeaker: "Name only",
            createCharacter: "New character",
            notASpeaker: "Not a speaker",
            existing: "character",
        },
        // The plain (Ctrl+Shift+V) path, which has no wizard to show what it is about to do.
        bulkConfirm: {
            one: "Paste {count} row?",
            other: "Paste {count} rows?",
        },
        bulkConfirmDetail: "This adds them below the current line as one undo step.",
        scriptFile: "This is a story script. Use Import Script to bring it back in.",
    },
    flow: {
        tabTitle: "Scene Flow",
        tabTitleNamed: "Scene Flow: {name}",
        node: {
            blocks: {
                one: "{count} block",
                other: "{count} blocks",
            },
        },
        badge: {
            entry: "Entry scene",
            unreachable: "Never reached from the entry scene",
            selfJump: {
                one: "{count} jump back into this scene",
                other: "{count} jumps back into this scene",
            },
            dangling: {
                one: "{count} jump with no valid target",
                other: "{count} jumps with no valid target",
            },
        },
        // Option-level branch rows drawn inside an expanded scene node. A "fork" is the question
        // (a choice, an if-group); a "branch" is one arm answering it.
        branch: {
            forkChoice: "Choice",
            forkCondition: "Condition",
            // Deliberately not "dead end": an arm whose own nested fork does the jumping falls
            // through too, and so does one that simply plays a line and rejoins the scene.
            fallsThrough: "continues",
            fallsThroughTitle: "No jump of its own; the scene continues past the fork",
            forkCount: {
                one: "{count} branch",
                other: "{count} branches",
            },
            expand: "Show branches",
            collapse: "Hide branches",
        },
        // The route rail: endings derived from the graph (a scene the story cannot leave) and
        // every decision path that reaches one.
        route: {
            title: "Routes",
            show: "Show routes",
            hide: "Hide routes",
            count: {
                one: "{count} route",
                other: "{count} routes",
            },
            // The header count once the walk hit the cap - the "+" is the whole point of the key.
            countTruncated: "{count}+ routes",
            // Says the list is capped AND that every number under it is about the capped list,
            // because a rail that shows 200 of 4000 routes silently reads as "these are all of them".
            truncated: "Capped at {count} routes. Counts and notes below cover only those.",
            noEntryScene: "No entry scene, so no routes.",
            noRoutes: "No routes.",
            noDecisions: "No decisions",
            // A path can stop in a scene that is not an ending, and calling that an ending is a lie.
            stopsHere: "stops here",
            stopsHereTitle: "A path stops here without being an ending. It returned to a visited scene, or an option has nothing written after it",
            diagnostics: {
                unreachableEndings: {
                    one: "{count} ending no route reaches",
                    other: "{count} endings no route reaches",
                },
                deadBranches: {
                    one: "{count} option on no route",
                    other: "{count} options on no route",
                },
            },
        },
        // Variable focus (好感度分歧线). A scene's chip is the value on ARRIVAL - before that
        // scene's own writes - so every string here has to avoid reading as a final value.
        variable: {
            none: "No variable focus",
            hintArrival: "Scene chips show the value on arrival",
            arrivalTitle: "Value on arrival, before this scene's own changes",
            finalTitle: "Value at the end of this route",
            rangeChip: "{name} {min}-{max}",
            valueChip: "{name} {value}",
            unknownChip: "{name} ?",
        },
        summary: {
            scenes: {
                one: "{count} scene",
                other: "{count} scenes",
            },
            jumps: {
                one: "{count} jump",
                other: "{count} jumps",
            },
            dangling: {
                one: "{count} broken jump",
                other: "{count} broken jumps",
            },
            unreachable: {
                one: "{count} unreachable",
                other: "{count} unreachable",
            },
        },
        hint: {
            openScene: "Double-click a scene to open it",
            // Says what the gesture DOES, not just that it exists: the map deliberately does not
            // write the jump, and an author who expects it to will read the opened editor as a
            // detour rather than as the point.
            connect: "Drag between scenes to write a jump",
        },
        // A line on the map, and the jumps behind it.
        edge: {
            reveal: "Show these jumps",
            disconnect: "Delete connection",
            confirmRemove: {
                one: "Delete the jump from {source} to {target}?",
                other: "Delete all {count} jumps from {source} to {target}?",
            },
            // Names the one thing an author cannot see from the map: a jump is a line in a scene,
            // possibly under a fork, and deleting the connection deletes those lines.
            confirmRemoveDetail: {
                one: "The jump is removed from {source}. This can be undone in the scene editor.",
                other: "All {count} jumps are removed from {source}. This can be undone in the scene editor.",
            },
            confirmRemoveAction: "Delete Jumps",
        },
        action: {
            resetLayout: "Reset Layout",
            openFlow: "Open Scene Flow",
        },
        empty: {
            noStory: "No story to map.",
            noScenes: "This story has no scenes yet.",
        },
    },
    stage: {
        notOnStage: "Not on stage",
        builtin: "Built-in",
    },
    targetField: {
        label: "Target",
        notOnStageTitle: "Not created earlier in this scene. Pick an existing displayable",
        placeholder: "Select displayable…",
        search: "Search stage displayables",
        noMatch: "No match.",
        kind: {
            character: "Character",
            image: "Image",
            text: "Text",
            layer: "Layer",
        },
    },
    layerField: {
        label: "Layer",
        defaultName: "Displayable layer",
        notOnStageTitle: "No layer with this name is declared earlier in this scene. Pick an existing layer",
        hint: "Layer",
        createNew: "Create new layer",
    },
    appearance: {
        noPoses: "This character has no poses yet.",
        noAxes: "This character has no layer axes yet.",
        unchanged: "unchanged",
        appearance: "Appearance",
        default: "Default",
        preview: "Preview",
    },
    pause: {
        title: "Pause",
        clickToProceed: "Click to proceed",
        waitFor: "Wait for",
        seconds: "s",
        clickHint: "Waits until the player clicks to continue.",
        remove: "Remove pause",
    },
    ruby: {
        title: "Ruby text",
        placeholder: "Reading",
        remove: "Remove ruby text",
    },
    /**
     * The popover a right click on a marked word opens.
     *
     * `addToDictionary` names the project's dictionary, not the machine's: the word travels with the
     * repository, so everyone working on this script spells the cast the same way.
     */
    spellcheck: {
        checking: "Looking for suggestions…",
        noSuggestions: "No suggestions",
        addToDictionary: "Add to project dictionary",
    },
    interpolation: {
        title: "Insert value",
        kindVariable: "Variable",
        kindBlueprint: "Blueprint",
        selectVariable: "Select a variable…",
        noVariables: "No variables declared",
        storyValueTitle: "Story Value",
    },
    richText: {
        collapse: "Collapse rich text tools",
        bold: "Bold",
        italic: "Italic",
        textColor: "Text color {color}",
        moreColors: "More colors from the project palette",
        insertPause: "Insert pause (waits for a click)",
        insertValue: "Insert inline value",
        insertValueHint: "Insert inline value (variable or blueprint)",
        insertExpression: "Insert expression change",
        ruby: "Ruby text",
        rubyHint: "Ruby text (select the words to annotate)",
        tools: "Rich text tools",
        pauseClick: "Pause (waits for a click)",
        pauseSeconds: "Pause {seconds}s",
        insertedValue: "Inserted value: {name}",
        valueFallback: "value",
        expressionEvent: "Expression change",
        soundEvent: "Sound effect",
    },
    inlineEvent: {
        title: "Inline event",
        noCharacter: "This row has no character.",
        sound: "Sound effect",
    },
    actionCreator: {
        starred: "Starred",
        searchPlaceholder: "Search actions",
        noActions: "No action found.",
        scopedTo: "Actions for {name}",
        addStarred: "Add to starred",
        removeStarred: "Remove from starred",
    },
    music: {
        missingAudio: "Missing audio",
        none: "No music",
    },
    background: {
        missingImage: "Missing image",
        none: "No background",
        unassigned: "unassigned",
    },
    /**
     * Names for the inline ghost hint on the command line — the grey `<Var Name>` trailing the caret.
     * Keyed by `StoryCommandParam.hint` (falling back to the param's `name`), so a slot is named once
     * and every command that shares it reads the same. Written as a noun phrase, title case, no
     * brackets: the renderer supplies the angle brackets.
     */
    paramHint: {
        // Variables and logic
        variableName: "Var Name",
        variable: "Variable",
        defaultValue: "Default Value",
        valueType: "Type",
        description: "Description",
        expressionValue: "Value or Expression",
        condition: "Condition",
        amount: "Amount",
        times: "Times",
        // Stage and media
        character: "Character",
        speaker: "Speaker",
        form: "Expression",
        motion: "Motion",
        skin: "Skin",
        puppetParam: "Parameter",
        puppetParamValue: "Value",
        imageAsset: "Image",
        imageOrColor: "Image or Color",
        videoAsset: "Video",
        audioAsset: "Audio",
        objectName: "Name",
        content: "Content",
        target: "Target",
        lineText: "Text",
        labelName: "Label",
        scene: "Scene",
        track: "Audio Track",
        appTag: "Build Variant",
        displayName: "Display Name",
        seekTime: "Seconds",
        // Camera
        cameraLookStrength: "Look Strength",
        // The two halves a blink can override; absent, each follows the whole move.
        effectIn: "In Seconds",
        effectOut: "Out Seconds",
        vignetteInner: "Clear Center %",
        vignetteOuter: "Dark Edge %",
        // Modifiers
        duration: "Seconds",
        transition: "Transition",
        reveal: "Reveal",
        placement: "Position",
        // Spelled as the two words rather than as a name for the slot, the way `cameraOperation` is:
        // a two-value positional teaches itself faster than a label an author has to guess at.
        mirrorState: "On / Off",
        waitFor: "Seconds or click",
        // Slots whose payload key already reads as its own name, so they carry no explicit `hint`
        // and fall back to it. Listed here so the coverage test can see them.
        fade: "Fade Seconds",
        loop: "Loop",
        vol: "Volume",
        volume: "Volume",
        rate: "Speed",
        muted: "Muted",
        color: "Color",
        hold: "Hold Seconds",
        opacity: "Opacity",
        size: "Font Size",
        z: "Z-Index",
        // The prop vocabulary (`commands/transformVocabulary.ts`) — one key per channel of the bag.
        zoom: "Zoom",
        scale: "Scale",
        scaleX: "Scale X",
        scaleY: "Scale Y",
        rotation: "Degrees",
        // The filter sugar. Named after what the author is doing, not after the CSS function, which
        // keeps its full name in the document where nothing is typing it.
        filterBlur: "Blur px",
        filterBrightness: "Brightness",
        filterContrast: "Contrast",
        filterGrayscale: "Grayscale",
        filterSaturate: "Saturation",
        filterSepia: "Sepia",
        filterHue: "Hue Degrees",
        filterInvert: "Invert",
        filterCss: "CSS Filter",
        cameraLook: "Look",
        maskImage: "Mask Image",
        clipPath: "Clip Path",
        backdropFilter: "Backdrop Filter",
        blendMode: "Blend Mode",
        storyMotion: "Story Motion",
        // Timing.
        easing: "Easing",
        delay: "Delay Seconds",
        repeat: "Repeat Times",
        repeatDelay: "Repeat Gap",
        fromProps: "Start Props",
        // Direction, which is what `/show` and `/hide` each say instead of the old "transition".
        conceal: "Conceal",
        screenEffect: "Blink / Vignette",
    },

    /**
     * The word a command line's enum VALUE is spelled with — the third and last of the three
     * vocabulary namespaces (`command.*.label`, `paramHint.*`, and this one).
     *
     * English deliberately spells each one exactly as its canonical value. That is not filler: it is
     * what a translator is handed, and it is the fallback a locale gets for any value it has not
     * translated yet — so a missing entry falls back to a word the parser certainly accepts rather
     * than to prose that might collide with another option. `localizedEnums.ts` drops any spelling
     * that merely echoes a canonical value, so these entries change nothing on their own.
     */
    enumValue: {
        // Transitions (`t=`), the unified word list from `commands/transitions.ts`.
        fade: "fade",
        // The crossfade named outright, for the contexts where `fade` means something else.
        dissolve: "dissolve",
        slide: "slide",
        "slide-left": "slide-left",
        "slide-right": "slide-right",
        "slide-up": "slide-up",
        "slide-down": "slide-down",
        circle: "circle",
        wipe: "wipe",
        iris: "iris",
        blur: "blur",
        blinds: "blinds",
        "barn-door": "barn-door",
        clock: "clock",
        fan: "fan",
        dots: "dots",
        black: "black",
        darkness: "darkness",
        exposure: "exposure",
        none: "none",
        // The transform presets `t=` reaches on a show/hide that the transition words did not name.
        scale: "scale",
        opacity: "opacity",
        // Which way `/mirror` leaves a sprite facing. Absolute, never a change: a compiled transform
        // cannot read the scale it would have to invert.
        on: "on",
        off: "off",
        // Placement (`at=`) and the camera's positional amount.
        left: "left",
        center: "center",
        right: "right",
        // Camera operations.
        pan: "pan",
        zoom: "zoom",
        rotate: "rotate",
        darken: "darken",
        look: "look",
        motion: "motion",
        reset: "reset",
        // The grades `/camera look` names. Registered here as well as in the inspector because this
        // namespace is what the command LINE prints and accepts: without them a row reads back in its
        // canonical English id on every locale, which is what `darken` beside it does not do.
        memory: "memory",
        monologue: "monologue",
        mono: "mono",
        moonlight: "moonlight",
        faint: "faint",
        hangover: "hangover",
        // Variable types.
        boolean: "boolean",
        number: "number",
        string: "string",
        json: "json",
        // CSS `mix-blend-mode`, spelled as CSS spells it: a blend mode is a property of the
        // MATERIAL an author prepared elsewhere, so the word here has to be the word in that tool.
        normal: "normal",
        multiply: "multiply",
        screen: "screen",
        overlay: "overlay",
        lighten: "lighten",
        "color-dodge": "color-dodge",
        "color-burn": "color-burn",
        "hard-light": "hard-light",
        "soft-light": "soft-light",
        difference: "difference",
        exclusion: "exclusion",
        hue: "hue",
        saturation: "saturation",
        color: "color",
        luminosity: "luminosity",
        // Easing curves (`ease=`), the same eleven the property inspector offers.
        linear: "linear",
        easeIn: "easeIn",
        easeOut: "easeOut",
        easeInOut: "easeInOut",
        circIn: "circIn",
        circOut: "circOut",
        circInOut: "circInOut",
        backIn: "backIn",
        backOut: "backOut",
        backInOut: "backInOut",
        anticipate: "anticipate",
        // The two screen-wide gestures, as `/screen`'s first positional.
        blink: "blink",
        vignette: "vignette",
    },

    /**
     * The unit a numeric value is written with — the fourth vocabulary namespace, built and dropped on
     * exactly the same rules as the three above (`localizedUnits.ts`).
     *
     * Keyed by the canonical unit the grammar declares. English spells it as itself for the same
     * reason `enumValue` does: it is the translator's anchor and the fallback a locale that has not
     * translated it gets — a spelling the parser certainly accepts.
     */
    unit: {
        /** Seconds. Every duration, fade and hold in the vocabulary is measured in these. */
        s: "s",
    },

    view: {
        density: "Reading density",
        "density.compact": "Compact",
        "density.standard": "Standard",
        "density.comfortable": "Comfortable",
        /** Which kinds of row the scene shows. The facet names are reading labels, not command categories. */
        filter: {
            title: "Filter rows",
            /** The two at the top of the panel: one preset, one way out. */
            dialogueOnly: "Dialogue only",
            clear: "Clear filter",
            sectionScript: "Script",
            sectionStaging: "Directions",
            sectionCast: "Cast",
            facet: {
                dialogue: "Dialogue",
                narration: "Narration",
                choice: "Choices",
                note: "Notes",
                character: "Character",
                stage: "Stage",
                camera: "Camera",
                scene: "Scene",
                sound: "Sound",
                flow: "Flow",
                data: "Variables",
                utils: "Other",
                invalid: "Invalid rows",
            },
        },
    },
    diagnostics: {
        missingAsset: "This row points at an asset the project no longer has.",
        unknownPuppetName: "This character's model does not have that name.",
    },
    find: {
        placeholder: "Find in scene",
        replacePlaceholder: "Replace with",
        caseSensitive: "Match case",
        wholeWord: "Match whole word",
        regex: "Use a regular expression",
        // The pattern would not compile. Sits where the hit count sits, because that is the question
        // it answers: there is no count, and this is why.
        invalidPattern: "Invalid pattern",
        noMatches: "No results",
        previous: "Previous match",
        next: "Next match",
        replace: "Replace",
        replaceAll: "Replace all",
        open: "Find and replace",
    },
    commandManual: {
        open: "Command manual",
        title: "Command manual",
        searchPlaceholder: "Search commands",
        aliases: "Aliases",
        empty: "No commands match",
    },
    manual: {
        title: "Commands",
        searchPlaceholder: "Search commands",
        empty: "No commands match",
        pick: "Pick a command to read what it does.",
        back: "All commands",
        insert: "Insert into the scene",
        aliases: "Also written",
        parameters: "Parameters",
        noParameters: "Takes no arguments.",
        examples: "Examples",
        required: "Required",
        optional: "Optional",
        greedy: "Takes the rest of the line",
        appliesTo: "Also filed under",
        star: "Star",
        unstar: "Unstar",
        type: {
            image: "Image asset",
            audio: "Audio asset",
            video: "Video asset",
            character: "Character",
            characterOrName: "Character, or any name",
            characterForm: "One of that character's expressions",
            puppet: {
                motion: "A motion provided by the runtime (blank returns it to rest)",
                expression: "An expression provided by the runtime (blank clears it)",
                skin: "A skin provided by the runtime (blank restores the default)",
                param: "A numeric parameter of the model, by id",
            },
            scene: "Scene",
            audioTrack: "Audio track",
            label: "Label in this scene",
            appTag: "Build variant",
            variable: "Variable",
            content: "New content, typed by the target",
            color: "Color",
            literal: "Any value",
            constant: "A constant value",
            text: "Text",
            expression: "Expression",
            expressionBoolean: "Expression, true or false",
            number: "Number",
            integer: "Whole number",
        },
        target: {
            character: "Character",
            image: "Image",
            text: "Text",
            layer: "Layer",
            video: "Video",
            audio: "Sound",
            vfx: "Effect",
        },
    },
    position: {
        label: "Position",
        left: "Left",
        center: "Center",
        right: "Right",
    },
    rows: {
        placeholderDialogue: "Dialogue…",
        // A row waiting for a speaker's words can go two ways — more words, or something done to
        // them — so both halves belong in the prompt. The verb tracks which end of the paragraph the
        // row is at: the one that opens a run starts it, the ones after it carry on.
        placeholderDialogueStart: "Start writing as {name}, or {trigger} to insert a character action",
        placeholderDialogueContinue: "Keep writing as {name}, or {trigger} to insert a character action",
        placeholderNarration: "Narration…",
        placeholderChoicePrompt: "Choice prompt…",
        placeholderChoiceText: "Option text…",
        placeholderNote: "Note…",
        placeholderText: "Text…",
        dragRow: "Drag row",
        // A grip on a selected row carries the whole selection, and says so before it is pulled — the
        // count is the only warning that a drag is about to move more than the line under the pointer.
        dragRows: {
            one: "Drag {count} row",
            other: "Drag {count} rows",
        },
        // Two strings per row button, and the difference is load-bearing: `insert`/`delete` are the
        // ACCESSIBLE NAMES and `insertTitle`/`deleteTitle` the tooltips, which add the keybinding. They
        // read the same because a screen reader and a pointer deserve the same sentence — these used to
        // be the bare words "Insert" and "Delete", left over from when the buttons had visible text, so
        // the only thing announced was a verb with no object. The shortcut stays out of the name (it
        // belongs to the tooltip and the cheat sheet, not to what the control IS), and the bracket
        // convention lives in the catalogue because zh wants full-width ones.
        insert: "Insert a blank row after this one",
        delete: "Delete this row",
        insertTitle: "Insert a blank row after this one ({keys})",
        deleteTitle: "Delete this row ({keys})",
        playFromRow: "Play from this row",
        playBranch: "Play this branch",
        insertPlaceholder: "Type narration, {trigger} for actions, # for characters…",
        insertPlaceholderCharacter: "Pick an action for {name}…",
        noCategoryActionFound: "No {category} action found.",
        actionTypes: "Action types",
        noCharacterFound: "No character found.",
        noCandidates: "No matches.",
        setBackground: "Set background",
        transform: "Transform",
        invalidHint: "won't build",
        // On a cut point row, beside the line that names the variant it ends. The short half is what
        // the row shows; the title is the whole sentence.
        cutPoint: "not in other builds",
        cutPointTitle: "The {name} build ends at this line. No other build contains this line.",
        cutPointInactive: "variant deleted",
        cutPointInactiveTitle: "The variant this line ended has been deleted, so it ends nothing.",
        tempSpeaker: "name only",
        createCharacter: "Create character “{name}”",
        voiceOutdated: "Voice outdated, open voice table",
        voiceManage: "Open voice table",
        voicePlay: "Play voice take",
        // "Stop" alone was the accessible name of a mid-row icon button; it now says what stops.
        voiceStop: "Stop voice take",
    },
    sceneEditor: {
        defaultSceneName: "Untitled Scene",
        untitledScene: "Untitled scene",
        changeBackgroundTitle: "Change default background",
        selectBackgroundTitle: "Select default background",
        change: "Change",
        select: "Select",
        sceneName: "Scene name",
        noDescription: "No description",
        defaultBackground: "Default background",
        clearBackground: "Clear background",
        sceneMusic: "Scene music",
        clearSceneMusic: "Clear scene music",
        selectSceneMusic: "Select Scene Music",
        sceneMusicVolume: "Volume",
        sceneMusicLoop: "Loop",
        sceneMusicFade: "Fade in (s)",
        sceneMusicLoopRegion: "Loops {from}s to {to}s",
        // Intro→loop: the head plays once, then the body repeats. Three markers, still one line.
        sceneMusicIntroLoop: "Plays {from}s, loops {loop}s to {to}s",
        sceneMusicFromIn: "Starts at {from}s",
        sceneMusicWholeClip: "Whole clip",
        backgroundResolveError: "Image asset could not be resolved: {error}",
        selectDefaultBackground: "Select Default Background",
        tabInvalid: "Story scene editor tab is invalid.",
        loadingScene: "Loading story scene…",
        notFound: "Story or scene not found.",
        addRow: "Click or type to add a row…",
        emptyHint: "This scene is empty. Type {trigger} on a new row to pick a command, or write a line of narration.",
        emptyExampleBg: "set the backdrop",
        emptyExampleShow: "bring someone on stage",
        emptyExampleSay: "give them a line",
        emptyOpenManual: "Open the command manual",
        /** The scene has rows, but the filter is hiding all of them — a different thing from an empty scene. */
        filteredEmpty: "No rows match the filter.",
        filteredEmptyClear: "Show all",
        snapshotsPanel: "Scene Snapshots",
    },
    preview: {
        label: "Preview",
        openPreview: "Open live preview",
        closePreview: "Close live preview",
        title: "Live Preview",
        dock: "Dock to sidebar",
        pip: "Picture-in-picture",
        selectRow: "Select a story row to preview its stage state.",
        failed: "Preview failed",
        playFromHere: "Play from here",
        restart: "Restart",
        stop: "Stop playback",
        mute: "Mute",
        unmute: "Unmute",
        playing: "Playing",
        ended: "Reached the end of the scene",
        endedAtJump: "Stopped at a scene jump",
        /**
         * Warnings the stage-snapshot walk raises when it has to approximate. They surface verbatim
         * under the preview pane, so they are author-facing prose, not log lines.
         */
        diagnostics: {
            targetNotFound: "Preview target block not found; previewing the scene start instead.",
            targetUnreachable: "Preview target is not reachable from the scene root; previewing the scene end instead.",
            repeatedGroupOnce: "Preview applies repeated groups once.",
            sceneJumpIgnored: "Preview ignores scene jumps.",
            choiceNotTaken: "Preview assumes no branch of this earlier choice was taken.",
            conditionUnresolved: "Condition `{expression}` did not resolve; it evaluates false in the preview.",
            blueprintConditionFalse: "Blueprint condition evaluates false in the preview.",
            persistentConditionDefaults: "Persistent-variable condition evaluates against defaults in the preview.",
            videoSkipped: "Videos are not previewed.",
            ambienceSkipped: "Ambience effects are not previewed.",
            storyActionSkipped: "Story Action Blueprint effects are not simulated in the preview.",
            displayableNotFound: "Displayable target not found: {target}",
            displayableUnnamed: "(empty)",
            persistentAssignmentSkipped: "Persistent-variable assignments are not applied in the preview.",
            assignmentUnresolved: "Expression `{expression}` did not resolve; the assignment was skipped in the preview.",
            blueprintCallEmpty: "Blueprint `{name}()` does not run in the preview; it reads as empty.",
            persistentReadEmpty: "Persistent variables read as empty in the preview.",
            sceneVisitUntracked: "Scene visits are not tracked in the preview; `visited({name})` reads as false.",
            choicePickUntracked: "Choice picks are not tracked in the preview; `picked({name})` reads as false.",
            presetNotFoldable: "{preset} transforms cannot be folded into character show yet.",
            animationNotFound: "Story animation not found: {animationId}",
            animationIdMissing: "Animation transform is missing animationId.",
        },
    },
    blueprintCard: {
        openAria: "Open story action blueprint",
        createAria: "Create story action blueprint",
    },
    condition: {
        title: "Condition",
        kindGraph: "Graph",
        kindExpression: "Expression",
        expressionPlaceholder: "gold >= 100 && !met",
        expressionVariables: "In scope: {names}",
        opIsOn: "is on",
        opIsOff: "is off",
        opEquals: "equals",
        opNotEquals: "does not equal",
        opExists: "is set",
        openGraphAria: "Open condition graph",
        createGraphAria: "Create condition graph",
        valueTrue: "true",
        valueFalse: "false",
        valuePlaceholder: "Value",
        clear: "Clear condition",
        summarySet: "Set condition…",
        summaryGraph: "Graph condition",
        summaryExpression: "Expression",
        fallbackVariable: "variable",
        fallbackPersistent: "persistent",
    },
    container: {
        addOption: "Add option",
        addAction: "Add action",
        addOptionInside: "Add option inside",
        addActionInside: "Add action inside",
        elseIf: "Else if",
        elseBranch: "Else",
    },
    repeat: {
        times: "times",
        // The header reads "Repeat until <condition>", so this is a preposition, not a label.
        until: "until",
    },
    bulkDelete: {
        confirm: "Delete {count} selected rows?",
        detail: "This removes the selected script rows and their children.",
    },
    actionCategory: {
        all: "All",
        character: "Character",
        stage: "Stage",
        image: "Image",
        text: "Text",
        layer: "Layer",
        video: "Video",
        vfx: "Ambience",
        camera: "Camera",
        scene: "Scene",
        sound: "Sound",
        data: "Data",
        flow: "Flow",
        utils: "Tools",
    },
    pluginActionFallbackDetail: "Plugin story action",
    /**
     * Labels for every command menu, keyed by command spec id (`story.command.<id>.label`).
     * The single source since A1: the sidebar's own `actionCommand` table (about 114 keys naming
     * block types rather than verbs) retired with the catalogue it labelled.
     */
    command: {
        background: { label: "Background", detail: "Set the scene background image or color" },
        jump: { label: "Jump", detail: "Go to another scene, unloading this one" },
        wait: { label: "Wait", detail: "Pause for seconds, or for a click" },
        nvl: { label: "NVL", detail: "Toggle the stacked dialogue panel" },
        show: { label: "Show", detail: "Show a character or a stage object" },
        hide: { label: "Hide", detail: "Hide a character or a stage object" },
        face: { label: "Face", detail: "Change a character's expression" },
        motion: { label: "Motion", detail: "Set the motion a runtime-drawn character plays" },
        param: { label: "Parameter", detail: "Set one numeric parameter of a runtime-drawn character's model" },
        skin: { label: "Skin", detail: "Set the skin a runtime-drawn character wears" },
        rename: { label: "Rename", detail: "Change the name a character speaks under" },
        say: { label: "Say", detail: "A line of dialogue" },
        image: { label: "Image", detail: "Put an image on stage" },
        text: { label: "Text", detail: "Put text on stage" },
        video: { label: "Video", detail: "Put a video on stage" },
        vfx: { label: "Ambience", detail: "A looping full-screen overlay: petals, rain, dust, light" },
        layer: { label: "Layer", detail: "Create a render layer" },
        swap: { label: "Swap", detail: "Replace an object's image or text" },
        play: { label: "Play", detail: "Play a video" },
        font: { label: "Font", detail: "Change a text's size or color" },
        bgm: { label: "BGM", detail: "Set the background music" },
        sound: { label: "Sound", detail: "Play a sound effect" },
        volume: { label: "Volume", detail: "Set a sound's volume (BGM by default)" },
        rate: { label: "Rate", detail: "Set a sound's speed (BGM by default)" },
        stop: { label: "Stop", detail: "Stop a sound or a video (BGM by default)" },
        pause: { label: "Pause", detail: "Pause a sound or a video (BGM by default)" },
        resume: { label: "Resume", detail: "Resume a sound or a video (BGM by default)" },
        mute: { label: "Mute", detail: "Mute a sound (BGM by default)" },
        unmute: { label: "Unmute", detail: "Unmute a sound (BGM by default)" },
        seek: { label: "Seek", detail: "Jump a video to a time" },
        set: { label: "Set", detail: "Assign a variable" },
        inc: { label: "Increase", detail: "Add to a number variable" },
        dec: { label: "Decrease", detail: "Subtract from a number variable" },
        toggle: { label: "Toggle", detail: "Flip a true/false variable" },
        reset: { label: "Reset", detail: "Put something back the way it was: a variable to its default, or a stage object to its neutral look" },
        declareLocal: { label: "Local variable", detail: "Declare a scene variable" },
        if: { label: "If", detail: "Branch on a condition" },
        menu: { label: "Menu", detail: "Present a set of options to the player" },
        repeat: { label: "Repeat", detail: "Run the enclosed actions a set number of times. For a condition instead, use /until" },
        // The detail carries the one thing the token cannot: `until` says when to STOP, so the group
        // runs while the condition is false. Named as a stop condition because that is what it is.
        until: { label: "Until", detail: "Repeat the enclosed actions until a condition becomes true. The condition is checked before each pass" },
        break: { label: "Break", detail: "Leave the repeat group this row sits in" },
        parallel: { label: "Parallel", detail: "Run the enclosed actions together" },
        race: { label: "Race", detail: "Run all, continue when the first finishes" },
        sequence: { label: "Sequence", detail: "Run the enclosed actions in order" },
        // The two details name each other: the whole difference is that /jump unloads the scene
        // and /goto does not, and no author can guess which from the token alone.
        label: { label: "Label", detail: "Mark a place in this scene for /goto to reach" },
        goto: { label: "Go to", detail: "Move the play head to a label in this scene. Unlike /jump, the scene keeps running" },
        // Named for the row it makes, not for the act of cutting: "Cut" alone reads as the clipboard
        // in an editor that has one. The detail carries the half the name cannot, which is that the
        // line belongs to one build and to no other.
        cut: { label: "Cut point", detail: "End one build variant's story at this line. Other builds do not have this line" },
        blueprint: { label: "Blueprint", detail: "Run a Story Action Blueprint" },
        // The detail line is where "kept across scenes" belongs — every command has one, and it is the
        // first thing an author reads about the camera in the slash menu and the command reference.
        // The one writing verb: every channel of the prop bag, on every subject, including the
        // camera (which is a reserved target name, not a command of its own).
        transform: { label: "Transform", detail: "Move, scale, rotate, mask, filter or fade anything on stage \u2014 or the camera" },
        screen: { label: "Screen", detail: "A screen-wide gesture: blink or vignette" },
        // The detail says "mirror", not "flip", because the word the command is named after is the
        // one thing it cannot explain: an author who is unsure what /flip does needs the other word.
        // The token is `mirror` because `flip` is a live alias of `/toggle`; the label follows the
        // token, since the word an author types and the word they read have to be the same one.
        note: { label: "Note", detail: "A Studio-only note" },
    },
    containerHeader: {
        condition: "Condition",
        if: "If",
        elseIf: "Else if",
        else: "Otherwise",
        repeat: "Repeat",
        repeatUntil: "Repeat until",
        parallel: "Run at the same time",
        race: "Race, first to finish",
        sequence: "In order",
        nvl: "NVL",
        menu: "Menu",
        option: "Option",
    },
    badge: {
        declare: { scene: "Local", saved: "Var", persistent: "Global" },
        narration: "Narration",
        dialogue: "Dialogue",
        choice: "Choice",
        choiceOption: "Choice option",
        background: "Background",
        character: "Character",
        audio: "Audio",
        variable: "Variable",
        wait: "Wait",
        image: "Image",
        transform: "Transform",
        displayable: "Displayable",
        text: "Text",
        layer: "Layer",
        video: "Video",
        vfx: "Ambience",
        nvl: "NVL",
        blueprint: "Blueprint",
        plugin: "Plugin",
        effect: "Effect",
        camera: "Camera",
        control: "Control",
        label: "Label",
        goto: "Go to",
        break: "Break",
        cut: "Cut point",
        jump: "Jump",
        note: "Note",
        invalid: "Invalid",
    },
    emptyPlaceholder: {
        narration: "Double-click to enter narration",
        option: "Double-click to enter option text",
        choice: "Double-click to enter choice prompt",
        note: "Double-click to enter a note",
        text: "Double-click to enter text",
    },
    characterName: {
        unassigned: "Unassigned character",
        unknown: "Unknown character",
    },
    // Compact one-line row summaries built by describeBlock(). {operation}/{effect}/{branch}/
    // {language} are enum tokens left untranslated; {name}/{scene}/{value}/{ms} are user data.
    describe: {
        narration: "Narration",
        dialogue: "Dialogue",
        choice: "Choice",
        option: "Option",
        setBackground: "Set background {value}",
        missingAsset: "Missing asset",
        unassigned: "unassigned",
        characterFallback: "character",
        charOp: {
            enter: "Enter",
            move: "Move",
            exit: "Exit",
            expression: "Expression",
            setName: "Rename",
            setMotion: "Motion",
            setSkin: "Skin",
            setParams: "Parameter",
        },
        waitDuration: "Wait {seconds}s",
        waitClick: "Wait for click",
        unnamed: "unnamed",
        // A puppet row that names no state is not unfilled - it is the request to clear one.
        puppetNone: "none",
        targetFallback: "target",
        image: "{operation} image {name}",
        text: "{operation} text {name}",
        layer: "{operation} layer {name}",
        video: "{operation} video {name}",
        vfx: "{operation} ambience {name}",
        nvl: "NVL block",
        blueprint: "Blueprint",
        // A plugin marker row whose plugin is not loaded, so there is no registration to read a
        // label out of. Deliberately generic: the only other thing the row holds is the plugin id,
        // and an id is not a name.
        pluginAction: "Plugin action",
        effect: "{effect} screen effect",
        cameraOp: {
            pan: "Pan",
            zoom: "Zoom",
            rotate: "Rotate",
            darken: "Darken stage",
            look: "Grade",
            motion: "Motion",
            reset: "Reset camera",
        },
        // A hand-written filter has no name to print, and its CSS is not a thing to show in a row.
        cameraLookCustom: "custom",
        condition: "Condition",
        branch: "{branch} branch",
        label: "Label {name}",
        goto: "Go to {name}",
        break: "Break out of the loop",
        cut: "{name} ends here",
        // No variant to name: the row holds an id nothing answers to, or this reader has no variant
        // list to ask. Says only what is true in both cases; the row's own mark, which does have the
        // list, is where a deleted variant is named as deleted.
        cutUnknown: "Cut point",
        jump: "Jump {scene}",
        note: "Note",
        invalid: "Invalid command",
        sceneUnassigned: "unassigned",
        sceneUnknown: "unknown scene",
        variableFallback: "variable",
        savedVariable: "saved variable",
        persistent: "persistent",
    },
    quickParam: {
        waitLabel: "Wait",
        jumpLabel: "Jump to",
    },
    lens: {
        toLens: "Timeline view",
        toList: "List view",
    },
    rowMenu: {
        insertAbove: "Insert above",
        insertBelow: "Insert below",
        duplicate: "Duplicate",
        disable: "Disable",
        enable: "Enable",
        playFromHere: "Play from here",
        openInspector: "Open inspector",
        delete: "Delete",
    },
    // Names for the undo steps these deletions leave behind ("Undo delete scene At the Station").
    history: {
        deleteScene: "delete scene {name}",
        deleteChapter: "delete chapter {name}",
        deleteStory: "delete story {name}",
        deleteAnimation: "delete motion {name}",
    },
    keybindings: {
        find: "Find and replace",
        deleteRows: "Delete selected story rows",
        deleteRowsConfirm: "Delete selected story rows with multi-select confirmation",
        undo: "Undo story scene edit",
        redo: "Redo story scene edit",
        editRow: "Edit the active row (or open its inspector)",
        closeInspector: "Close the property editor",
        insertRow: "Insert a new story row below the active row",
        indent: "Indent selected story rows",
        outdent: "Outdent selected story rows",
        selectAll: "Select all visible story rows",
        duplicateRows: "Duplicate selected story rows",
        moveSelectionDown: "Move story row selection down",
        moveSelectionUp: "Move story row selection up",
        extendSelectionDown: "Extend story row selection down",
        extendSelectionUp: "Extend story row selection up",
        moveRowDown: "Move the selected story rows down",
        moveRowUp: "Move the selected story rows up",
        selectFirst: "Select the first story row",
        selectLast: "Select the last story row",
        pageDown: "Move story row selection down a page",
        pageUp: "Move story row selection up a page",
    },
} as const;
