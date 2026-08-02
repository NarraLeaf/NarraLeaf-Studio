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
        summaryHint: "Nothing compared the contents. These are the numbers each version reports about itself.",
        structural: "Structural",
        structuralHint: "Compared by JSON structure alone. Nothing here knows what these values mean, so generated ids and reordered lists read as changes.",
        opaque: "Not read",
        opaqueHint: "Too large, not text, or unreadable - only its size is reported.",
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
        incomplete: "{shown} of {total} changed paths were compared. The rest were left out to stay inside the comparison budget.",
        documentsOmitted: "{count} more files are not listed here.",
        unavailable: "Version control is not available in this project.",
    },
} as const;
