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
        assets: "Assets",
        audioTracks: "Audio tracks",
        /** The author's own colors. The seeded palette is always there and is not counted. */
        brandColors: "Brand colors",
        characterGroups: "Character groups",
        characters: "Characters",
        localizationKeys: "Localization keys",
        storyBlocks: "Story rows",
        storyChapters: "Chapters",
        storyScenes: "Scenes",
        translationUnits: "Translations",
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
        notInspected: "This file was not inspected",
        moreInGroup: "{count} more inside",
        viewAll: "View all {count}",
        showing: "Showing {shown} of {total}",
    },
    rail: {
        expand: "Show what changed inside",
        collapse: "Hide what changed inside",
        compareWithPrevious: "Compare with the previous version",
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
     * which conflicts have been decided, so the record is this window's - and saying so beats
     * implying a progress that closing the tab would silently discard.
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
        finish: "Finish the merge",
        finishUndecided: {
            one: "{count} file still needs a side",
            other: "{count} files still need a side",
        },
        notSaved: "These choices are kept only while this window is open. Nothing is written until the merge is finished.",
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
} as const;
