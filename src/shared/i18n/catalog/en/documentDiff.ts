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
        other: "Changed outside the totals",
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
        dlc: "DLC",
        assetSets: "Asset sets",
        assets: "Assets",
        folders: "Asset folders",
        audioTracks: "Audio tracks",
        /** The author's own colors. The seeded palette is always there and is not counted. */
        brandColors: "Brand colors",
        /** The project's default font stack. Counted whole - every rung is one the author added. */
        brandFonts: "Default fonts",
        characterGroups: "Character groups",
        characters: "Characters",
        dictionaryTerms: "Dictionary terms",
        transformPresets: "Transform presets",
        localizationKeys: "Localization keys",
        projectLanguages: "Languages",
        projectPlugins: "Plugins",
        saveFields: "Save fields",
        stories: "Stories",
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
     * Tier 2, the story library: which stories exist and what they are called.
     *
     * Only merge rows, because the library has no semantic diff of its own yet - a comparison walks
     * it structurally. `subject` carries the story's own title, so none of these names it again.
     */
    storyIndex: {
        added: "Story added",
        removed: "Story removed",
        /** One side added and the other deleted, or the two arrived with no common ancestor. */
        changed: "Story changed",
        renamed: "Story renamed",
        /** `dlcId`, `importSource`, `exportMeta` - none of which has a word the author typed. */
        entryField: "{field} changed",
        defaultStory: "Starting story changed",
        documentField: "{field} changed",
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
        /**
         * Words for the fields the character editor shows but never labels.
         *
         * Every other field the comparison reports is answered with the key the panel the author
         * edits it in already uses - see `CHARACTER_FIELD_NAME_KEY`. These six have no such key to
         * borrow: the cast list prints a character's nicknames under their name with no caption,
         * group membership is set by moving a row rather than by filling a field, and the canvas,
         * the avatar axes, the PSD a stack was imported from and the state a puppet rests in are
         * each reached through a button or a bare control. So each is named from the vocabulary
         * those controls already use ("Set canvas", "Avatar varies with this axis", "Import PSD")
         * rather than coined here.
         *
         * They sit here rather than in `characters.*` because this is the surface that draws them:
         * a label under the panel's own namespace that no panel renders would be taken for the
         * panel's word the next time someone looks for one, and there would then be two of them.
         *
         * `attributes` and `options` are deliberately absent. Studio has no surface for either -
         * both are bags a plugin or an import writes through - so their rows keep the stored name,
         * which is the only name anyone able to reach them has.
         */
        fields: {
            nicknames: "Nicknames",
            group: "Group",
            canvas: "Canvas",
            avatarAxes: "Avatar axes",
            psd: "PSD",
            puppetDefaultState: "Default state",
        },
        groupRenamed: "Group renamed",
    },
    /**
     * Tier 1, one language's translation library - the document whose whole content is text.
     *
     * The comparison and the three-way merge share the first three. Nothing here names the unit and
     * nothing can: a unit id is a story text id or a `key:`/`char:`/`scene:` handle, never a word
     * the author typed. What identifies a row is the translation itself, drawn beside the label as
     * the value pair - which is why `changed` says only that a line was translated again and leaves
     * the two texts to the pair.
     *
     * The four status lines state what the unit now is, in the translation table's own four words,
     * rather than pairing the two identifiers the file keeps them under.
     */
    localization: {
        added: "Translation added",
        removed: "Translation removed",
        changed: "Translation changed",
        note: "Note changed",
        /** The translation did not change; the line it was written from is a different line now. */
        source: "Written against a different source line",
        statusUntranslated: "Now untranslated",
        statusMachine: "Now a machine translation",
        statusTranslated: "Now translated",
        statusReviewed: "Now reviewed",
    },
    /**
     * Tier 2 only, the developer-authored named strings.
     *
     * Three words rather than the comparison's fuller list, because these are decision rows: what a
     * merge asks about one key is which side's definition to keep, and the key itself - the one map
     * in the project whose keys somebody typed - is what identifies the row.
     */
    localizationKeys: {
        added: "Named string added",
        removed: "Named string removed",
        changed: "Named string changed",
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
        /**
         * A file of asset contents that no record in the comparison names.
         *
         * Its own name is a shard of an id, so there is nothing in the path to call it. It is left
         * on the list rather than folded away, because a merge that dropped a metadata record while
         * keeping the bytes is exactly the state this row is the only evidence of.
         */
        orphanContent: "File with no asset record",
    },
    /**
     * Tier 1, the project's palette.
     *
     * `subject` is the author's own name for a colour, which the seeded entries do not have - their
     * names are translated strings the panel supplies, so a row for one carries the two colours and
     * no name, and `BrandChangeDetail` draws the whole palette underneath.
     */
    brand: {
        added: "Color added",
        removed: "Color removed",
        renamed: "Renamed",
        /** The value pair is the two colours, drawn as swatches rather than read as text. */
        value: "Color changed",
        /** The default font stack. One row for the whole list: a rung is stored as an asset id. */
        fonts: "Default fonts changed",
    },
    /**
     * Tier 1, the build variants - the editions one project ships as.
     *
     * Every line below the first three names its field rather than saying "changed", which is the
     * one shape all eight can take. Four of them are long names the variant panel already uses
     * ("Page shown when the story ends"), and four of them are used TWICE: once under a variant,
     * where `subject` names it, and once alone for the value every variant inherits from the
     * project. A verb would have to be dropped from the first four and reworded for the second.
     * What happened is on the row already - the marker, and the two values beside it.
     *
     * `version` says whose version it is. This surface is full of version numbers of its own
     * (`#3`, `#7`), and an unqualified "Version" reads as one of those.
     */
    appTags: {
        added: "Variant added",
        removed: "Variant removed",
        renamed: "Renamed",
        /** The three identity fields. An absent value on one side is the variant inheriting it. */
        displayName: "Application name",
        identifier: "Identifier",
        version: "Project version",
        plugins: "Plugin settings",
        assetAxes: "Assets the build uses",
        scenes: "Scenes that can be started",
        ending: "Page shown when the story ends",
        order: "Variant order",
    },
    /**
     * Tier 1, the project's mixer.
     *
     * `rerouted` is the row this tier exists for. Where a bus feeds decides what its gain is
     * multiplied by and which fader reaches it, and it moves no count - so under the summary tier a
     * re-routed track was a file that changed in a way nothing could name. The two bus names are
     * the value pair; a track that now hangs off the master has no parent to name, which is why
     * that case has a line of its own instead of half a pair.
     */
    audioTracks: {
        added: "Track added",
        removed: "Track removed",
        renamed: "Renamed",
        rerouted: "Routes into a different bus",
        reroutedToMaster: "Routes into the master output",
        /** The value pair is the fader's own number, out of 100, not the stored 0 to 1. */
        volume: "Volume changed",
        /** The policy that holds now, because `true` and `false` are the file's words for it. */
        loopOn: "Loops by default",
        loopOff: "Plays once by default",
        order: "Tracks reordered",
        /** Tier 2 only: a merge decides a whole track at a time, never a field of one. */
        changed: "Track changed",
    },
    /**
     * Tier 1, the project's saved and global variables.
     *
     * `defaultValue` is the row this tier exists for: it is what every playthrough starts from and
     * what a save written before the variable existed reads as, so it changes the shipped game
     * while moving no count at all. The scope lines state what the variable now is rather than
     * pairing two stored words, one of which ("persistent") is not what the panel calls that scope.
     */
    variables: {
        added: "Variable added",
        removed: "Variable removed",
        renamed: "Renamed",
        defaultValue: "Default value changed",
        valueType: "Type changed",
        scopeSaved: "Now a saved variable",
        scopeGlobal: "Now a global variable",
        /** The key the value is kept under, which a rename is designed never to touch. */
        storageKey: "Values already saved are no longer found",
        description: "Note changed",
        /** Tier 2 only: a merge decides a whole variable at a time, never a field of one. */
        changed: "Variable changed",
    },
    /**
     * Tier 1, the fields one save slot carries.
     *
     * `removed` is the only line here that says what a change costs, and the only one that needs
     * to. Adding a field is safe by construction - a slot with no value for it reads the default -
     * while removing one takes away the pins that read it, and every save already on a player's
     * disk is left holding a value nothing in the project can ask for again.
     */
    saveSchema: {
        added: "Save field added",
        removed: "Save field removed. Existing saves keep the value, nothing reads it.",
        renamed: "Renamed",
        valueType: "Type changed",
        defaultValue: "Default changed",
        /** The key inside the save, fixed at creation so that a rename cannot orphan what is written. */
        storageKey: "Values already saved are no longer found",
        description: "Note changed",
        /** Where it sits among the pins on the save nodes. Nothing about the game changes. */
        reordered: "Moved among the fields",
    },
    /**
     * Tier 1, the project's own vocabulary.
     *
     * There is no `renamed` here and there cannot be one: a dictionary entry has no id, the
     * spelling is the identity, so a respelt term is one term gone and another arrived. The two
     * option lines say what the dictionary does now, because they change what the story editor
     * marks in every script in the project.
     */
    /**
     * The transforms the project saved to reuse. What a preset does carries no value pair: a bag of
     * channels is a record rather than a value, and quoting one onto a single line reads as nothing.
     */
    transformPresets: {
        added: "Preset added",
        removed: "Preset removed",
        renamed: "Preset renamed",
        transform: "Preset transform changed",
    },
    dictionary: {
        added: "Term added",
        removed: "Term removed",
        reading: "Reading changed",
        /** A list, so no value pair: two lists of spellings on one line cannot be read at any width. */
        variants: "Variant spellings changed",
        note: "Note changed",
        readingsOn: "Readings are suggested",
        readingsOff: "Readings are not suggested",
        variantsOn: "Variant spellings are checked",
        variantsOff: "Variant spellings are not checked",
    },
    /**
     * Tier 1, the project's own settings - what the game is called, and everything a build, a save
     * and a player's first launch reads out of it.
     *
     * One row per area of the project and one child per setting inside it, because that is how the
     * author reaches them: these values are spread over fourteen panels and are known by the words
     * those panels use, not by the names the file keeps them under. The value pair rides beside the
     * row, so a policy or a mode is quoted in the file's own word rather than reworded here.
     *
     * `field` is the last resort, and five areas rest on it entirely - the signing credentials, the
     * distribution key, and the remembered state of the build, patch and check dialogs. Four of
     * those are a dialog's memory and one is a key nobody types; author copy for their fields would
     * claim a panel that does not exist.
     */
    project: {
        name: "Application name",
        identifier: "Identifier",
        /** A setting this build has no word for, named as the file keeps it. */
        field: "{field} changed",
        metadata: "Details",
        metaVersion: "Project version",
        metaDescription: "Description",
        metaAuthor: "Author",
        metaEmail: "Contact email",
        metaWebsite: "Website",
        /** One line, in the packaged binaries' file properties. */
        metaCopyright: "Copyright",
        /** The full notice, shipped beside the game. */
        metaCopyrightText: "Copyright notice",
        metaResolution: "Window size",
        metaIcons: "Icons",
        network: "Network access",
        networkPolicy: "Network policy",
        networkAllowlist: "Network request allowlist",
        networkHttp: "Plain HTTP requests",
        networkRemoteResource: "Remote resources",
        networkRemoteScript: "Remote scripts",
        localization: "Languages",
        sourceLocale: "Source language",
        locales: "Language list",
        voice: "Voice-over",
        voicedLocales: "Voiced languages",
        voiceNaming: "Voice file naming",
        voiceCast: "Voice cast",
        voiceChoices: "Voiced choices",
        dialogue: "Dialogue",
        dialogueAutoForwardPause: "Pause length under auto forward",
        preferences: "Player defaults",
        prefTextSpeed: "Text speed",
        prefGameSpeed: "Game speed",
        prefAutoForward: "Auto forward",
        prefAutoForwardDelay: "Auto forward wait",
        prefShowDialog: "Show the dialogue box",
        prefSkip: "Allow skipping",
        prefSkipReadText: "Skip read text only",
        prefSkipDelay: "Skip delay",
        prefSkipInterval: "Skip interval",
        prefGlobalVolume: "Master volume",
        prefBgmVolume: "Music volume",
        prefSoundVolume: "SFX volume",
        prefVoiceVolume: "Voice volume",
        prefVoiceEndMode: "When a voiced line ends",
        prefVoiceFadeDuration: "Voice fade",
        autoSave: "Saving",
        autoSaveEnabled: "Automatic saving",
        autoSaveInterval: "Save every",
        autoSaveSlots: "Autosaves kept",
        saveCompatibility: "Older saves",
        saveCompatible: "Saves from another project version",
        saveIncompatible: "Saves from before a story change",
        saveLocation: "Player files",
        saveLocationWindowsLinux: "Windows and Linux",
        saveLocationMacos: "macOS",
        languageChange: "Language switching",
        languageChangeInGame: "Changing language during a game",
        security: "Security",
        encryptAssets: "Encrypt assets",
        crash: "Crashes",
        crashPolicy: "When the game stops working",
        preload: "Loading",
        preloadBehavior: "Preload behavior",
        assetCompression: "Compression",
        compressImages: "Compress images",
        imageMode: "Image settings",
        imageQuality: "Image quality",
        imageWebpQuality: "WebP quality",
        imageMaxDimension: "Maximum image size",
        compressAudio: "Compress audio",
        audioMode: "Audio settings",
        audioQuality: "Audio quality",
        audioBitrateKbps: "Audio bitrate",
        audioSampleRateHz: "Maximum sample rate",
        compressVideo: "Compress video",
        videoMode: "Video settings",
        videoQuality: "Video quality",
        videoCrf: "Video CRF",
        videoMaxHeight: "Maximum video height",
        vfx: "Screen effects",
        vfxFrameRate: "Weather frame rate",
        mobile: "Mobile",
        mobileOrientation: "Orientation",
        mobileFit: "Screen fit",
        mobileCropX: "Keep horizontally",
        mobileCropY: "Keep vertically",
        distribution: "Distribution key",
        signing: "Signing",
        build: "Build settings",
        patch: "Patch export settings",
        linting: "Project check",
        dependencies: "Dependencies",
        dependencyPlugins: "Plugin list",
    },
    /**
     * Which of the four tiers answered - the caption that stops a structural list from reading as a
     * semantic one. `semantic` has none: it is the claim that needs no caveat.
     */
    tier: {
        summary: "Summary only",
        summaryHint: "Only the totals were compared, not the contents.",
        structural: "Structural",
        structuralHint: "This list may include differences that are not edits.",
        content: "Format only",
        contentHint: "What the file reports about itself was compared. Its contents were not.",
        opaque: "Not read",
        opaqueHint: "Only the size of this file was compared.",
    },
    rows: {
        loading: "Reading the comparison…",
        empty: "Nothing differs inside this file",
        // Three ways of being empty, because "modified" plus "nothing differs" reads as a
        // contradiction and each tier can support a different claim. See documentDiffEmptyKey.
        emptyFormatting: "Only formatting changed",
        emptyUntracked: "No change visible in the editor",
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
    /**
     * What the author calls each kind of document.
     *
     * The fallback for a thing with no name of its own. Never a file name: the author did not
     * make a file, they made a project, a story, a set of pages.
     */
    name: {
        project: "Project settings",
        storyIndex: "Story list",
        story: "Story",
        animationIndex: "Motion list",
        animation: "Motion",
        uiDocument: "Interface pages",
        uiGraphs: "Interface blueprints",
        blueprint: "Blueprint",
        variables: "Variables",
        audioTracks: "Audio tracks",
        brand: "Brand palette",
        appTags: "Build variants",
        dlc: "Additional content",
        dictionary: "Dictionary",
        transformPresets: "Transform presets",
        saveSchema: "Save fields",
        assetSets: "Asset sets",
        localization: "Translations",
        localizationKeys: "Translation keys",
        voice: "Voice lines",
        assetsMetadata: "Asset library",
        assetsGroups: "Asset folders",
        assetsOrder: "Asset order",
        characters: "Cast",
        assetContent: "Asset file",
        qualified: "{name} ({qualifier})",
    },
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
        selectPrompt: "Open a heading and select a file to see its changes.",
        /** What one file's row says when the file was modified rather than added or removed. */
        changes: {
            one: "{count} change",
            other: "{count} changes",
        },
        fileAdded: "Added",
        fileRemoved: "Removed",
        fileMoved: "Moved",
        /**
         * In a row's tooltip, for a document that is stored as several files.
         *
         * Never on the row itself: one line per document is the one structural rule this pane has,
         * and a second number on the line would put "3 changes" and "2 files" side by side, which
         * reads as a contradiction.
         */
        setFiles: {
            one: "{count} file in this document changed",
            other: "{count} files in this document changed",
        },
        /**
         * Said once under a heading, never on a row.
         *
         * Covers both shortfalls at once because the author's next move is the same for either: a
         * file compared below the semantic tier and a file whose change list was cut short are both
         * files whose detail has the specific caveat on it.
         */
        partial: {
            one: "{count} file here may have changes not listed",
            other: "{count} files here may have changes not listed",
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
        readFailure: "This comparison could not be read: {error}",
        incomplete: "{shown} of {total} changed documents were compared.",
        documentsOmitted: "{count} more documents are not listed here.",
        unavailable: "Version control is not available in this project.",
    },
    /**
     * One document at two versions, in a tab of its own.
     *
     * The words the split arrangement itself adds, and nothing more: what a change SAYS is under the
     * tier keys above and is the same wherever the change is drawn. Each half is named for the
     * version it shows, so nothing here names a version - `revisionLabel` does that, from a number.
     */
    split: {
        open: "Open side by side",
        /** The newer half of a working-tree comparison: the files as they are now. */
        thisProject: "This project",
        /** On a gap one version holds where the other has content. */
        notInVersion: "Not in this version",
        resize: "Resize the two halves",
        previous: "Previous change",
        next: "Next change",
        /**
         * Which change of how many. Drawn rather than worded, for the reason a value pair is: it is
         * read at a glance beside two buttons, and a sentence there would be read as a sentence.
         */
        position: "{index} / {total}",
        gone: "This file is not in this comparison.",
        /** A row that selects the element it is about, so the right rail can show its properties. */
        inspect: "Inspect {name}",
    },
    /**
     * The right rail while an element of one half is selected.
     *
     * The rail draws the same inspector the interface editor draws, over the version that half is
     * showing. So nothing here describes a field - the fields say what they always say - and what
     * these keys add is the one thing the fields cannot: which version this is, and that it is a
     * picture of one rather than a canvas.
     */
    inspector: {
        /** Above the fields, so the rail never leaves which version unsaid. */
        version: "From {version}",
        /** An element the other half does not hold at all. Stated, rather than left as a blank. */
        onlyHere: "Not in {version}",
        readOnly: "A comparison is read-only. Open the interface editor to edit these properties.",
        /**
         * What the other half holds for one field, on the hover of the dot beside its name. Drawn as
         * a pair rather than worded, for the reason a change's own two values are.
         */
        differs: "{version}: {value}",
        /** The counterpart where there is no value at all - an empty text, a cleared colour. */
        noValue: "Empty",
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
        notSaved: "Nothing is written to the project files until the merge is finished.",
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
                noSpec: "Studio does not recognise this file's format, so it cannot merge parts of it.",
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
        oneChange: "Showing one change",
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
        offCanvas: "{count} outside every page",
        /**
         * Marked nowhere because the drawn page has no handle on the element.
         *
         * Content inside a component instance is the expected case: every placement of one
         * definition shares the element ids inside it, so that content carries no id at all and six
         * placements would otherwise be indistinguishable.
         */
        unplaced: "{count} with no place on a page",
        /**
         * The pictures on screen that are not this version's, in the same line as the marks.
         *
         * A mark drawn in a widget's place has no room for words at the size a page is drawn
         * here, so this is where the reason is. The two reasons stay apart because the author's
         * next move differs: an asset imported after this version is nothing to look into, and a
         * file that would not read is.
         */
        assetsNotShown: {
            one: "{count} asset is not shown here:",
            other: "{count} assets are not shown here:",
        },
        assetsAbsent: "{count} not in this version",
        assetsFailed: "{count} could not be read",
        /** Four reasons a column has no picture in it, and they stay four. */
        notDrawn: "This version of the page could not be drawn.",
        emptyGraph: "This graph has no nodes.",
        tooLarge: "This file is too large to draw here.",
        unreadable: "This file could not be read as an interface document: {error}",
        readFailed: "This version could not be read: {error}",
    },
} as const;
