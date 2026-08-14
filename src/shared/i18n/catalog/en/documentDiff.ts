/**
 * What a comparison between two versions of a document says, in words.
 *
 * Two halves, and the first one is not written for this catalogue's convenience: every key under
 * `document.` / `opaque.` / `summary.` / `structural.` is emitted by a producer in the MAIN process
 * (`vcs/diff/documentDiff.ts` and `shared/documents/jsonStructuralDiff.ts`), which hands back a
 * translation key plus parameters and never a sentence. Renaming one of those keys here breaks the
 * label silently - it renders as the key itself - so they are spelled out in the producers as
 * constants and must be changed in both places at once.
 *
 * **Values are not in these templates.** A change's `from` / `to` parameters are the author's own
 * data, and the surface draws them as a pair with an arrow between them rather than folding them
 * into a sentence, so that a 320px rail can truncate the value without truncating the sentence and
 * so that no locale has to word "a became b" for every kind of thing that can change. The
 * parameters templates DO carry are the ones that name something: `{name}`, `{index}`, `{bytes}`.
 */
export const documentDiff = {
    /** The document itself appeared or went away; one row, whatever is inside it. */
    document: {
        added: "Added ({bytes})",
        removed: "Removed ({bytes})",
    },
    /** Tier 4: read as bytes, because nothing here can read it as anything else. */
    opaque: {
        changed: "Changed ({fromBytes} → {toBytes})",
        unread: "Changed, not inspected",
    },
    /**
     * An asset, described from its header instead of read.
     *
     * Emitted by `vcs/diff/contentDiff.ts`, whose providers are handed a file's size and content
     * address plus at most a few kilobytes of its front. So these rows are what a bitmap, a sound,
     * a video or a font says about itself, and every one of them is conditional: a container that
     * keeps its length at the end of the file reports no duration, and a font whose name table sits
     * past the prefix reports no family.
     *
     * `changed`, `notInspected` and `unrecognized` are three different facts and must stay three
     * separate sentences. The first says the header was read and reports the same numbers; the
     * second says this comparison did not spend the bytes; the third says Studio will never have
     * more to say about this format. An author who cannot tell a budget from a permanent limit
     * cannot tell whether looking again would help.
     */
    content: {
        size: "Size ({fromBytes} → {toBytes})",
        /** Its own row, because a resolution change is what breaks a layout. */
        dimensions: "Dimensions ({fromWidth}×{fromHeight} → {toWidth}×{toHeight})",
        duration: "Length ({fromSeconds}s → {toSeconds}s)",
        sampleRate: "Sample rate ({fromHertz} Hz → {toHertz} Hz)",
        /** The family name out of the font itself, which is why it is also carried as the subject. */
        family: "Family ({from} → {to})",
        changed: "Contents changed",
        notInspected: "Contents changed. The header was not read.",
        unrecognized: "Contents changed. Studio does not recognise this format.",
        /** A deletion and an addition that hold the same bytes: the file was renamed or moved. */
        moved: "Moved from {from}",
    },
    /** Tier 2: what each side says about itself. */
    summary: {
        title: "Name",
        /** `{name}` is itself a key - see `count` below - resolved before it reaches this template. */
        count: "{name}",
        other: "Changed, in a way the summary does not show",
    },
    /** Tier 3: JSON paths. Generic by construction; the caption above the list says so. */
    structural: {
        property: "{name}",
        element: "Item {index}",
        root: "The document itself",
    },
    /**
     * What a spec's summary counts, by the stable key `DocumentSummaryCount.key` carries.
     *
     * A key with no entry here falls back to the raw identifier rather than to a missing-key
     * warning, because a spec may add a count before anyone translates it - and `audioTracks` in
     * the list is a far better failure than a blank row.
     */
    count: {
        /** The author's own variants. The release tag is always there and is not counted. */
        appTags: "Build variants",
        assets: "Assets",
        audioTracks: "Audio tracks",
        /** The author's own colors. The seeded palette is always there and is not counted. */
        brandColors: "Brand colors",
        characterGroups: "Character groups",
        characters: "Characters",
        dictionaryWords: "Dictionary words",
        localizationKeys: "Localization keys",
        storyBlocks: "Story rows",
        storyChapters: "Chapters",
        storyScenes: "Scenes",
        translationUnits: "Translations",
        uiBlueprints: "Blueprints",
        uiComponents: "Components",
        uiElements: "Interface elements",
        uiGraphNodes: "Blueprint nodes",
        uiSurfaces: "Surfaces",
        variables: "Variables",
        voiceUnits: "Voice lines",
    },
    /**
     * Tier 1, the story spec: scenes and rows, the units the author wrote in.
     *
     * `subject` carries the author's own word (a scene's name, a row's text) and is drawn BESIDE
     * these, so none of them names the thing again. The `{field}` ones quote a raw field identifier
     * because that is what the producer has - there is no authored word for `entrySceneId`.
     */
    story: {
        renamed: "Story renamed",
        /** Also a chapter's `meta`, where the chapter's name arrives as `subject`. */
        documentField: "{field} changed",
        chapterAdded: "Chapter added",
        chapterRemoved: "Chapter removed",
        chapterRenamed: "Chapter renamed",
        /** Reordered, or a scene moved in or out. The two values are the two lengths. */
        chapterScenes: "Scene list changed",
        chapterOrder: "Chapters reordered",
        sceneAdded: "Scene added ({blocks} rows)",
        sceneRemoved: "Scene removed ({blocks} rows)",
        sceneChanged: "Scene changed",
        sceneRenamed: "Renamed",
        sceneField: "Scene {field}",
        blockAdded: "Row added",
        blockRemoved: "Row removed",
        blockChanged: "Row changed",
        /** Re-parented, not re-ordered - `blockOrder` is the one that says a list was rearranged. */
        blockMoved: "Row moved",
        blockKind: "Row kind changed",
        blockDisabled: "Row disabled",
        blockEnabled: "Row enabled",
        blockField: "{field} changed",
        blockOrder: "Rows reordered",
    },
    /**
     * Tier 1, the character store.
     *
     * The row this whole tier exists for is `poseAsset` / `layerOptionAsset`: "Alice's angry
     * differential points at a different image", where `subject` is the pose or the tag.
     */
    characters: {
        castOrder: "Cast reordered ({count})",
        added: "Character added",
        removed: "Character removed",
        changed: "Character changed",
        renamed: "Renamed",
        profileField: "Profile {field}",
        /** preset / layered / puppet. The two kinds are drawn as the value pair. */
        kindChanged: "Appearance kind changed",
        poseAdded: "Pose added",
        poseRemoved: "Pose removed",
        poseRenamed: "Pose renamed",
        poseAsset: "Points at a different image",
        poseChanged: "Pose changed",
        poseOrder: "Poses reordered",
        defaultPose: "Default pose changed",
        axisAdded: "Axis added",
        axisRemoved: "Axis removed",
        axisChanged: "Axis changed",
        layerAdded: "Layer added",
        layerRemoved: "Layer removed",
        layerChanged: "Layer changed",
        layerAsset: "Points at a different image",
        /**
         * One tag's image inside a layer, which may have been gained, lost or swapped - so a noun
         * rather than a verb, with the row's own marker saying which. Carries no `{layer}` / `{tag}`
         * parameter on purpose: the producer omits either when it has no authored name for it, and a
         * placeholder with nothing to fill it renders as `{layer}` at the author.
         */
        layerOptionAsset: "Layer image",
        layerOrder: "Layers reordered",
        appearanceField: "Appearance {field}",
        /** `{key}` is a pose id or a tag combination - never the author's word, hence not `subject`. */
        avatarChanged: "Dialog avatar {key}",
        groupAdded: "Group added",
        groupRemoved: "Group removed",
        groupRenamed: "Group renamed",
    },
    /**
     * One translation unit, as a three-way merge reads it.
     *
     * Emitted only by `merge3` - this format has no semantic diff yet - and there is no `subject`
     * beside them: a unit id is a story text id or a `key:`/`char:` handle, never a word the author
     * typed. What identifies the row for them is the two translations drawn underneath it.
     */
    localization: {
        added: "Translation added",
        removed: "Translation removed",
        changed: "Translation changed",
    },
    /**
     * Tier 1, the interface document: Surfaces and the elements on them.
     *
     * `subject` carries the author's own word - a Surface's name, an element's name - and is drawn
     * beside these, so none of them names the thing again. An element that changed is one row with
     * its properties underneath, which is why the `element*` lines below read as fragments: they sit
     * under "Element changed" and each says only which part of it moved.
     */
    uiDocument: {
        renamed: "Interface renamed",
        surfaceAdded: "Surface added ({elements} elements)",
        surfaceRemoved: "Surface removed ({elements} elements)",
        surfaceChanged: "Surface changed",
        surfaceRenamed: "Renamed",
        /** The design area the Surface is laid out in - not the resolution it is rendered at. */
        surfaceDesignSize: "Design size ({fromWidth}×{fromHeight} → {toWidth}×{toHeight})",
        surfaceSettings: "Background or page animation changed",
        surfaceRoot: "Root element changed",
        surfaceField: "{field} changed",
        componentAdded: "Component added ({elements} elements)",
        componentRemoved: "Component removed ({elements} elements)",
        componentChanged: "Component changed",
        componentRenamed: "Renamed",
        componentField: "{field} changed",
        elementAdded: "Element added",
        elementRemoved: "Element removed",
        elementChanged: "Element changed",
        elementRenamed: "Renamed",
        /** The widget it is - a text became a button. The two type ids are drawn as the value pair. */
        elementType: "Element kind changed",
        /** Re-parented, not re-ordered - `elementOrder` is the one that says a list was rearranged. */
        elementMoved: "Moved to another parent",
        elementOrder: "Children reordered",
        elementLayout: "Position or size changed",
        elementStyle: "Style changed",
        elementProps: "Contents changed",
        elementBehavior: "Behavior changed",
        elementBinding: "Binding changed",
        elementAnimation: "Animation changed",
        elementField: "{field} changed",
    },
    /**
     * Tier 1, the blueprint document: the logic behind the interface.
     *
     * `nodeMoved` is the line this whole tier is shaped around. Dragging a node changes nothing the
     * player will ever see, and reported in the same words as an edit to a parameter it would rank
     * a tidy-up equal with a change to what the game does. It is a separate row, with a separate
     * marker, for that reason alone.
     *
     * Nothing here names a node. A node's type is an identifier (`blueprint.event.head.appBoot`)
     * whose human name comes from a table the editor owns, and quoting the identifier at the author
     * would read as something they typed.
     */
    uiGraphs: {
        /** Which of an owner's blueprints is the live one. */
        ownerRecord: "Active blueprint changed",
        blueprintAdded: "Blueprint added ({nodes} nodes)",
        blueprintRemoved: "Blueprint removed ({nodes} nodes)",
        blueprintChanged: "Blueprint changed",
        blueprintRenamed: "Renamed",
        /** A TypeScript blueprint, whose whole program is one file. */
        blueprintSource: "Code changed",
        blueprintField: "{field} changed",
        graphAdded: "Graph added ({nodes} nodes)",
        graphRemoved: "Graph removed ({nodes} nodes)",
        graphChanged: "Graph changed",
        graphRenamed: "Renamed",
        graphField: "{field} changed",
        graphOrder: "Graphs reordered",
        nodeAdded: "Node added",
        nodeRemoved: "Node removed",
        nodeChanged: "Node changed",
        nodeParams: "Values changed",
        /** Dragged across the canvas. Says so plainly, so it can be skipped just as plainly. */
        nodeMoved: "Moved on the canvas",
        nodeType: "Node kind changed",
        nodeField: "{field} changed",
        edgeAdded: "Connection added",
        edgeRemoved: "Connection removed",
    },
    /** Tier 1, one `assets.metadata.<type>.json` shard: the author's metadata for their assets. */
    assets: {
        added: "Asset added",
        removed: "Asset removed",
        changed: "Asset changed",
        renamed: "Renamed",
        /** The content hash moved: the file behind the record is different bytes now. */
        content: "File contents replaced",
        field: "{field} changed",
    },
    /**
     * Which of the four tiers answered - the caption that stops a structural list from reading as a
     * semantic one. `semantic` has none: it is the claim that needs no caveat.
     */
    tier: {
        summary: "Summary only",
        summaryHint: "The contents were not compared. These are the numbers each version reports about itself.",
        structural: "Structural",
        structuralHint: "Compared by JSON structure alone, so generated ids and reordered lists read as changes.",
        content: "Format only",
        contentHint: "What the file reports about itself was compared. Its contents were not.",
        opaque: "Not read",
        opaqueHint: "Too large, not text, or unreadable. Only its size is reported.",
    },
    rows: {
        loading: "Reading the comparison…",
        empty: "Nothing differs inside this file",
        // Three ways of being empty, because "modified" plus "nothing differs" reads as a
        // contradiction and each tier can support a different claim. See documentDiffEmptyKey.
        emptyFormatting: "Only formatting changed",
        emptyUntracked: "Nothing the editor tracks changed",
        emptyCounts: "The totals are unchanged",
        moreInGroup: "{count} more inside",
        showing: "Showing {shown} of {total}",
    },
    rail: {
        compareWithPrevious: "Compare with the previous version",
    },
    /**
     * What a format's own detail says, where one has been written (`renderer/lib/vcs/presenters`).
     *
     * Only the words a presenter adds. What a change SAYS is still under the tier keys above and is
     * the same wherever it is drawn - a presenter that restated one would be a second wording of
     * the same fact, drifting from the first.
     */
    presenter: {
        /**
         * The two versions, named once for every presenter.
         *
         * Shared rather than repeated per format: the pair appears under an image, under a
         * waveform, over a type sample and above a column of swatches, and two spellings of the
         * same word in one comparison is the drift this namespace exists to avoid.
         */
        before: "Before",
        after: "After",
        image: {
            /** The three comparisons, as a segmented control. */
            modeLabel: "Comparison",
            sideBySide: "Side by side",
            swipe: "Slider",
            difference: "Difference",
            splitPosition: "Split position",
            /**
             * Why only two of the three are offered.
             *
             * The difference mode subtracts one image from the other, which needs the same pixels
             * in the same places; stretched onto one frame, two sizes differ everywhere and the
             * result would light up whole and say nothing.
             */
            sizeDiffers: "The two versions are different sizes, so they cannot be compared pixel by pixel.",
            /** Four states a frame can be in instead of a picture, and they stay four. */
            tooLarge: "This file is too large to show here.",
            unsupported: "This image format cannot be shown here.",
            unreadable: "This image could not be read.",
        },
        audio: {
            play: "Play",
            pause: "Pause",
            /** How many channels the decoded file turned out to have. */
            mono: "Mono",
            stereo: "Stereo",
            channels: "{count} channels",
            /**
             * Four states a track can be in instead of a waveform, and they stay four.
             *
             * `tooLarge` is about the file, which was never read. `tooLong` is about the sound: the
             * bytes are here and decoding them would cost more memory than a preview may spend, so
             * the numbers below are still reported and only the picture is withheld.
             */
            tooLarge: "This file is too large to play here.",
            tooLong: "This track is too long to preview here.",
            unreadable: "This sound could not be read.",
        },
        font: {
            /** The sample is one string at several sizes; this names the control that picks one. */
            sizeLabel: "Size",
            /**
             * The specimen, and the reason it is not "The quick brown fox".
             *
             * A project that installs a font installs it to set Chinese as well as Latin, and a
             * Latin pangram says nothing about whether the Chinese glyphs came with it or whether
             * the renderer is falling back to a system face for them.
             */
            sample: "The quick brown fox 0123 汉字排版样张",
            unreadable: "This font could not be loaded.",
            tooLarge: "This file is too large to show here.",
        },
        brand: {
            /** A colour an author added or removed, beside the ones that merely changed. */
            added: "Added",
            removed: "Removed",
            /** The palette is a document, and a document can be unreadable. */
            unreadable: "This palette could not be read.",
            tooLarge: "This file is too large to show here.",
            /** American in the copy, British in the prose around it, as everywhere else here. */
            unchangedOne: "1 color is unchanged",
            unchangedMany: "{count} colors are unchanged",
            /**
             * A value that points at another entry of the same palette and never lands on a
             * colour: a name nothing defines, or a ring.
             */
            unresolved: "No color",
        },
    },
    /**
     * The headings changed files are grouped under.
     *
     * Named after the panels an author edits those things in, not after the folders they live in:
     * the grouping exists so a comparison reads as "the story changed" rather than as a path list.
     * The classification is in `renderer/lib/vcs/changeCategory.ts`.
     */
    category: {
        story: "Story",
        characters: "Characters",
        interface: "Interface",
        assets: "Assets",
        localization: "Localization",
        audio: "Audio",
        settings: "Project",
        other: "Other",
    },
    /**
     * The comparison's two panes: an index of changed files, and one file's changes beside it.
     *
     * Everything here is about navigating the comparison. What a change SAYS is under the tier keys
     * above, and is the same wherever the change is drawn.
     */
    shell: {
        fileList: "Changed files",
        resize: "Resize the file list",
        /** Only reachable by closing every heading, which is a thing an author can do. */
        selectPrompt: "Open a heading and pick a file to see what changed in it.",
        /** What one file's row says when the file was modified rather than added or removed. */
        changes: {
            one: "{count} change",
            other: "{count} changes",
        },
        fileAdded: "Added",
        fileRemoved: "Removed",
        fileMoved: "Moved",
        /**
         * Said once under a heading, never on a row.
         *
         * Covers both shortfalls at once because the author's next move is the same for either: a
         * file compared below the semantic tier and a file whose change list was cut short are both
         * files whose detail has the specific caveat on it.
         */
        partial: {
            one: "{count} file here was not compared in full",
            other: "{count} files here were not compared in full",
        },
    },
    tab: {
        workingTree: "Changes",
        between: "{from} → {to}",
        comparingWorkingTree: "This project against {version}",
        comparingWorkingTreeUnknown: "This project against the last version",
        comparingRevisions: "{from} against {to}",
        refresh: "Read again",
        empty: "Nothing differs between these two versions",
        emptyWorkingTree: "Nothing has changed since the last version",
        readFailure: "The bytes for this comparison could not be read: {error}",
        incomplete: "{shown} of {total} changed paths were compared. The rest were left out.",
        documentsOmitted: "{count} more files are not listed here.",
        unavailable: "Version control is not available in this project.",
    },
    /**
     * Finishing a merge by taking one side of each file.
     *
     * The vocabulary is "keep mine / keep theirs" rather than the backend's `mine`/`theirs`, and
     * "the version you got" rather than a revision hash where one can be named: an author who
     * pressed "Get from server" is reconciling their work with a colleague's, not resolving a
     * three-way merge.
     *
     * `notSaved` is the sentence this whole surface is honest because of. Nothing readable records
     * which conflicts have been decided, so the record is Studio's rather than the repository's -
     * and saying so beats implying a progress the project itself knows about.
     *
     * It used to add "only while this window is open", which was true and is no longer: the choices
     * are kept in a draft beside the project (`mergeDecisionDraft`). What has not changed is the
     * half that matters - not one file moves until Finish - so that is what the line now says, and
     * nothing more. It is not the place to explain where a draft lives.
     */
    resolve: {
        tab: "Merge",
        merging: "Two versions of this project are being merged",
        none: "This project is not in the middle of a merge.",
        automerged: "Everything merged automatically. Finish to record it as a version.",
        count: {
            one: "{count} file changed on both sides. Choose which side to keep.",
            other: "{count} files changed on both sides. Choose which side to keep.",
        },
        takeMine: "Keep mine",
        takeTheirs: "Keep theirs",
        takeAllMine: "Keep mine everywhere",
        takeAllTheirs: "Keep theirs everywhere",
        rowsOmitted: "{count} more files are not listed here. Use the two links above to choose for all of them.",
        /** The two panes: the conflicted files, and the changes inside the one being looked at. */
        fileList: "Conflicted files",
        /** The controls on one file's row, named as the question they answer. */
        decision: "Which side to keep",
        /**
         * The state a file starts in, and the only one of the three that wears a marker.
         *
         * It is what stops the merge being finished, so it has to be findable without reading every
         * button on every row.
         */
        pending: "No side chosen",
        selectPrompt: "Pick a file to see the changes inside it.",
        finish: "Finish the merge",
        finishUndecided: {
            one: "{count} file still needs a side",
            other: "{count} files still need a side",
        },
        notSaved: "Nothing is written to your files until the merge is finished.",
        abandon: "Abandon",
        abandonConfirm: "Abandon this merge?",
        abandonConfirmDetail:
            "Every file returns to its state before these versions were fetched from the server, including the files that merged automatically. Nothing is lost. The versions can be fetched again.",
        /**
         * Tier two: choosing change by change inside one file.
         *
         * Two words carry the whole distinction and neither may be dropped. `auto` is the row that
         * was already decided BY THE MERGE, not by the author - it is drawn as settled, with the
         * other side reachable on hover, because pressing nothing there is the right answer almost
         * always. A `conflict` row has no such default at all, and the reasons under `blocked` are
         * why a file has no per-change list rather than an empty one.
         */
        change: {
            expand: "Show the changes inside",
            collapse: "Hide the changes inside",
            loading: "Reading both versions…",
            /** Said once above the list, so no row has to repeat it. */
            heading: "Merged automatically unless marked. Hover a merged row to take the other side.",
            none: "The two versions of this file have identical contents.",
            auto: "Merged",
            /** The one an author can flip on a merged row; only one of the two is ever offered. */
            useMine: "Use mine",
            useTheirs: "Use theirs",
            /** A side that does not have this entry at all - which is what taking it would do. */
            absent: "Not there",
            /** Fields past the few a row draws. Nothing is hidden that a choice depends on. */
            moreFields: "+{count} more",
            undecided: {
                one: "{count} change still needs a side",
                other: "{count} changes still need a side",
            },
            /** Back to tier one, and each of these says which wall was hit. */
            blocked: {
                title: "This file has to be kept whole from one side.",
                noSpec: "Studio does not know this file's format, so it cannot merge parts of it.",
                noMerge3: "Studio can read this format but cannot merge two versions of it change by change.",
                readOnly: "Studio can merge this format but cannot write the result back, so the whole file has to come from one side.",
                tooLarge: "This file is too large to merge change by change.",
                tooMany: "There are too many changes in this file to decide one at a time.",
                unreadable: "One of the two versions could not be read, so only the whole file can be taken.",
            },
        },
    },
    /**
     * Two versions of one page or one graph, drawn side by side with what changed washed over it.
     *
     * Shared by both canvases (`renderer/lib/vcs/presenters`), because they are one idea seen twice
     * and an author reads them in the same minute - a word that differed between them would read as
     * a difference in what happened.
     *
     * Nothing here restates what a change SAYS. That is under the tier keys above and is the same
     * wherever the change is drawn; these are only the words the canvas itself adds.
     */
    canvas: {
        before: "Before",
        after: "After",
        /** Accessible names for the two selectors. The current value is the trigger's own text. */
        surfaceLabel: "Page",
        graphLabel: "Graph",
        /** A page or a graph whose author never named it. Never an id: they did not type that. */
        unnamed: "Untitled",
        /**
         * What the four washes mean.
         *
         * `moved` is the odd one out and is worded to say why it is drawn faintly: an element
         * re-ordered under its parent or a node dragged across the canvas changed nothing about
         * what the game does.
         */
        legend: {
            added: "Added",
            removed: "Removed",
            changed: "Changed",
            moved: "Moved only",
        },
        /** One mark. Its own words are in the row underneath, which the mark selects. */
        markLabel: "Show this change",
        /**
         * Back to the whole graph in the frame, after dragging or zooming.
         *
         * The blueprint editor's words for the same control, because it is the same picture and
         * the same result; a second phrase for it would read as a second behaviour.
         */
        fitView: "Fit view",
        oneChange: "Showing one change.",
        showAll: "Show every change",
        /**
         * The changes this canvas is not marking, said in one line and never in silence.
         *
         * A canvas that marks nine of twelve and says nothing is read as a complete answer, and the
         * author concludes the change they were looking for did not happen. The three parts stay
         * apart because the next move differs for each of them.
         */
        notMarked: {
            one: "{count} change is not marked here:",
            other: "{count} changes are not marked here:",
        },
        onOtherPages: "{count} on other pages",
        onOtherGraphs: "{count} in other graphs",
        /** Inside a component definition, outside every page, or about the file itself. */
        offCanvas: "{count} cannot be drawn on a page",
        /**
         * Marked nowhere because the drawn page has no handle on the element.
         *
         * Content inside a component instance is the expected case: every placement of one
         * definition shares the element ids inside it, so that content carries no id at all and six
         * placements would otherwise be indistinguishable.
         */
        unplaced: "{count} could not be located",
        /** Four reasons a column has no picture in it, and they stay four. */
        notDrawn: "This version of the page could not be drawn.",
        emptyGraph: "This graph has no nodes.",
        tooLarge: "This file is too large to draw here.",
        unreadable: "This file could not be read as an interface document: {error}",
        readFailed: "This version could not be read: {error}",
    },
} as const;
