/**
 * `lint` - project lint: rule titles and messages, the report tab, the console channel, and the
 * Project -> Linting settings section.
 *
 * Two conventions this namespace holds to, both enforced by tests elsewhere:
 *
 *  - Every rule has `title`, `description` and `message` under its camelCase slug
 *    (`lint.rule.<slug>`), and `registry.test.ts` fails if a registered rule is missing any of them
 *    in either catalogue. A rule's variant messages sit beside `message` as `message<Variant>`. The
 *    handful of ids no rule owns (`LINT_RULELESS_IDS`) carry only `title` and `description`; their
 *    messages live under `lint.message` because more than one of them can produce the same finding.
 *  - Titles are short noun phrases; descriptions are one clause and appear only in a hint popover.
 *    Nothing here is a sentence explaining the UI - the interface does not narrate itself.
 *
 * **A message never names the place it was found.** Every surface that prints one prints the site
 * beside it - the report tab in its own column, the build console through
 * `nonRedundantLintLocation` - so "First Day jumps to the undeclared label ending" said "First Day"
 * twice, and the half of the sentence that told the two findings apart was the half that got
 * ellipsed away. The message is the predicate; the locator is the subject.
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "Unused asset",
            description: "Nothing in the project references this asset",
            message: "{asset} is not used anywhere",
            // The three the rule reports instead of a list, when the reference index does not
            // cover the whole project. Naming the site is the point: "the index is incomplete" on
            // its own gives an author nothing to go and look at.
            messageIndexUnresolved: "Unused assets not listed: {location} points at an asset that cannot be identified",
            messageIndexUnreadable: "Unused assets not listed: which assets {location} uses could not be determined",
            messageIndexNotBuilt: "Unused assets not listed: the project could not be scanned",
            help:
                "No story row, page, blueprint, character, voice-over, font list or plugin in the project "
                + "names this asset.\n"
                + "\n"
                + "When part of the project cannot be read for the assets it uses, the unused assets it could "
                + "be using are not listed, and a finding names that part instead: a widget whose picture was "
                + "pasted as an address from an earlier session, a blueprint node whose plugin is not loaded, a "
                + "document that would not open, or a blueprint with a script layer. If the whole project could "
                + "not be scanned, run the check again.\n"
                + "\n"
                + "Builds leave out files nothing uses, and the game is unaffected. The file still takes up "
                + "space in the project.\n"
                + "\n"
                + "- Delete the asset: right-click it in the Assets panel and choose Delete.\n"
                + "- For a widget, choose its picture again from the assets. For a blueprint node, install or "
                + "switch on the plugin that provides it.\n"
                + "- To keep assets that are not used yet, set this rule to Off under Project ▸ Project ▸ "
                + "Project check.",
        },
        assetsMissing: {
            title: "Missing asset",
            description: "A reference names an asset the library no longer has",
            message: "{location} references a missing asset",
            help:
                "A place in the project names an asset the library no longer has. Most often the asset was "
                + "deleted after the place chose it. Each place is reported once, and the finding names it.\n"
                + "\n"
                + "In the game that place goes without the asset: a picture is not drawn and a sound does not "
                + "play.\n"
                + "\n"
                + "- Open the place and choose an asset the library has, or remove what names the missing one.\n"
                + "- An asset deleted earlier in this session comes back with Undo, and every place that named "
                + "it works again.\n"
                + "- Importing the same file again does not help: an import is a new asset, and the place still "
                + "names the old one.",
        },
        assetsUnreadable: {
            title: "Unreadable asset",
            description: "The file cannot be read or decoded",
            message: "{asset} is damaged or is not in a format Studio can open",
            messageMissingBytes: "{asset} cannot be read from disk",
            help:
                "The asset's file is missing from the project folder or Studio is not allowed to read it, or, "
                + "for an image, the file is damaged or not in a format Studio can open. Only images are opened "
                + "to check their contents, and models are not checked. A remote asset that shows Not "
                + "downloaded yet in Properties has no file.\n"
                + "\n"
                + "A build that carries an asset with no file stops with an error. A damaged image shows "
                + "nothing where it is used.\n"
                + "\n"
                + "- Give the asset a working file: right-click it in the Assets panel and choose Replace "
                + "File…. Every place that uses it keeps working.\n"
                + "- For a remote asset, select it and choose Check for Updates in Properties.",
        },
        assetsOversized: {
            title: "Large file",
            description: "A file a build carries that is over the size this project allows",
            // Both numbers in the sentence: what this file is, and what the project said, so the
            // finding can be acted on without opening the settings page it came from.
            message: "{asset} is {size}, over the {limit} a build should carry",
            help:
                "A file that something in the project uses, and that is larger than this project's limit. The "
                + "limit is 64 MB unless changed under this rule on Project ▸ Project ▸ Project check. The size "
                + "is that of the file in the project, before any compression a build applies, and a file whose "
                + "size Studio has not recorded is not reported.\n"
                + "\n"
                + "Nothing breaks. The cost is a larger package and a longer download for the player.\n"
                + "\n"
                + "- Make the file smaller outside Studio, then right-click the asset in the Assets panel and "
                + "choose Replace File…. Every place that uses it keeps working.\n"
                + "- Compression under Project ▸ Settings makes the copy in the build smaller. This check still "
                + "measures the file in the project.\n"
                + "- Raise the limit, or set this rule to Off, under Project ▸ Project ▸ Project check.",
        },
        assetsGroupIncomplete: {
            title: "Unfinished asset set",
            description: "A set that does not resolve to exactly one file for every variant it declares",
            // The variant is a language's code or an edition's name, never the tag it is stored as:
            // an edition's id is a uuid. The file that would resolve is not named: it does not exist yet.
            message: "{set} has no file for {variant}",
            messageAmbiguous: "{set} has {count} files for {variant}",
            messageResidency: "{set} varies by variant and sits under a set that varies by language, which no build can resolve",
            messageDeclaration: "{set} declares no values to resolve",
            /** The one thing a set requires. Without it nothing in the set resolves at all. */
            messageFallback: "{set} does not say which value the others fall back to",
            help:
                "An asset set that does not give exactly one file for each of its values. A value with no "
                + "file of its own takes the fallback value's file, so a missing file is reported only while "
                + "the fallback value has no single file. Also reported: a value more than one file answers to, "
                + "a set with no values or no fallback, and a set varying by build variant placed under a set "
                + "varying by language.\n"
                + "\n"
                + "A build that ships something using the set stops when a value it needs has no single file.\n"
                + "\n"
                + "- Select the set in the Assets panel. In Properties, click a value's row under Values to "
                + "choose its file, or choose a value that has a file under Falls back to.\n"
                + "- Where a row shows several files, delete the extra files or remove that value's tag from "
                + "them under Tags.\n"
                + "- Choosing an entry under Varies by, the current one included, reads the values again from "
                + "the project's languages or build variants. A deleted value is dropped, and Falls back to "
                + "returns to the first value.\n"
                + "- A set placed under the wrong kind of set: right-click it and choose Dissolve Set. Its "
                + "files stay in the library.",
        },
        portabilityAssetName: {
            title: "Unsafe file name",
            description: "Characters or names some filesystems reject",
            message: "{asset} has a file name some systems do not accept as written",
            help:
                "The asset's file name, its name with the extension, contains a character Windows refuses in "
                + "file names (< > : \" | ? * or an invisible control character), begins or ends with a space, "
                + "ends with a full stop, or is a name Windows reserves, such as CON, NUL, COM1 or LPT1, with "
                + "or without an extension. Chinese, Japanese and other non-Latin names are not reported.\n"
                + "\n"
                + "The game and its builds do not depend on this name. It is used when the asset is exported "
                + "with Export…, which writes it under an altered name; on Windows a reserved name cannot be "
                + "exported.\n"
                + "\n"
                + "- Rename the asset: right-click it in the Assets panel and choose Rename.\n"
                + "- To keep the name, set this rule to Off under Project ▸ Project ▸ Project check.",
        },
        portabilityCaseCollision: {
            title: "Case collision",
            description: "Names that differ only by letter case",
            message: "{asset} differs from {other} only in letter case",
            help:
                "Two assets whose file names, the names with their extensions, are the same apart from letter "
                + "case, such as Title.png and title.png. The first of them in the library is left alone, and "
                + "each later one is reported with the first one's name.\n"
                + "\n"
                + "Builds keep both files, and each place in the game uses the one it chose. Exporting both "
                + "into one folder on Windows or macOS gives the second a numbered name.\n"
                + "\n"
                + "- Rename one of them: right-click it in the Assets panel and choose Rename.\n"
                + "- When both names are intended, set this rule to Off under Project ▸ Project ▸ Project "
                + "check.",
        },
        portabilityMediaFormat: {
            title: "Unplayable format",
            description: "A codec some selected build targets cannot play",
            message: "{asset} does not play on {platform}",
            help:
                "An audio or video asset in the Ogg format, judged by its extension and checked against the "
                + "platforms chosen in Build for distribution for the most recent build. Ogg audio (.ogg, .oga, "
                + ".opus) is reported for iOS and Web, and Ogg video (.ogv, .ogm, .ogx) for every platform. A "
                + "project that has never been built is not checked.\n"
                + "\n"
                + "Some versions of Safari do not play Ogg audio, so the sound is silent in the iOS build and "
                + "in a Web build opened in Safari. Ogg video plays its sound over a black picture on every "
                + "platform.\n"
                + "\n"
                + "- Convert Ogg audio to .m4a or .mp3 outside Studio, then right-click the asset in the Assets "
                + "panel and choose Replace File…. Every place that uses it keeps working.\n"
                + "- An Ogg video is marked Needs converting in the Assets panel, and Convert File… replaces it "
                + "with a copy that plays.",
        },
        portabilityVfxAlpha: {
            title: "Transparent overlay clip",
            description: "An overlay clip whose transparency some selected build targets ignore",
            message: "{asset} covers the stage on {platform}",
            help:
                "An ambience row (/vfx) whose clip carries transparency and whose Blend is Normal (opaque "
                + "clip), checked when the platforms chosen in Build for distribution for the most recent build "
                + "include iOS or Web. Rows set to another blend mode are not reported, and neither are clips "
                + "Studio cannot inspect on this computer.\n"
                + "\n"
                + "iOS, and Safari in a Web build, ignore the clip's transparency, so its whole frame covers "
                + "the stage. Studio, Dev Mode and the other platforms show the transparency, so the problem "
                + "does not appear when testing on a computer.\n"
                + "\n"
                + "- Export the clip on a black background and set the row's Blend to Screen (glow on black), "
                + "or on white and set it to Multiply (shadow on white).\n"
                + "- A clip whose pixels are all opaque can be exported without transparency. The picture does "
                + "not change, and the finding goes away.",
        },
        networkFetchNotAllowlisted: {
            title: "Address not on the allowlist",
            description: "A Fetch node aimed at an address this project does not allow",
            message: "{url} is not on this project's network request allowlist",
            help:
                "A Fetch node whose address is written out, typed into its URL or wired from a String node, "
                + "and is not covered by the Network request allowlist, while Network policy is Allowlisted "
                + "addresses only. Addresses declared by installed plugins count as covered. An address the "
                + "blueprint assembles while it runs is not checked here, and is refused when the game requests "
                + "it.\n"
                + "\n"
                + "A build does not start while such a node remains, whatever this rule is set to, and the game "
                + "refuses the request.\n"
                + "\n"
                + "- Add the address, or a pattern covering it, to the allowlist under Project ▸ Settings ▸ "
                + "Security. The scheme, host and port must match exactly.\n"
                + "- Correct the address on the node if it is mistyped.\n"
                + "- To allow every request, set Network policy to Any address.",
        },
        networkFetchDisallowed: {
            title: "Network node without network access",
            description: "A network node in a project whose network policy is off",
            message: "{blueprint} makes a network request, which this project does not allow",
            help:
                "A Fetch, Read Response Text or Read Response JSON node in a blueprint, while the project's "
                + "Network policy is No network access. Every such node is reported, including one nothing is "
                + "connected to.\n"
                + "\n"
                + "A build does not start while the project holds such a node, whatever this rule is set to. In "
                + "Dev Mode a Fetch node fails and continues from its Network Error output.\n"
                + "\n"
                + "- Delete the node if the game does not use the network.\n"
                + "- To allow requests, set Network policy under Project ▸ Settings ▸ Security to Allowlisted "
                + "addresses only and add the addresses, or to Any address.",
        },
        /**
         * The one entry here with no rule behind it. A story document the schema ladder refuses is
         * never handed to a rule, so it has no row in Project -> Project and no severity to set;
         * only a name, because the report groups by rule and these findings need a heading. What
         * one says is `message.storyTooOld` / `.storyTooNew` / `.storyLoadFailed` below.
         */
        storyUnreadable: {
            title: "Unreadable story",
            description: "A story document this Studio cannot open",
            help:
                "The story's file could not be opened. The message says why: a story format older than this "
                + "Studio opens, a format written by a newer NarraLeaf Studio, or a file that is damaged or "
                + "incomplete.\n"
                + "\n"
                + "The story cannot be edited, and the other checks skip it, so problems inside it are not "
                + "listed. This problem is always an error and has no row in Project ▸ Project ▸ Project check.\n"
                + "\n"
                + "- Newer format: open the project in the NarraLeaf Studio version that wrote it, or a later "
                + "one.\n"
                + "- Older format: open and save the story in an earlier NarraLeaf Studio release that still "
                + "reads it, then open the project here again.\n"
                + "- Damaged file: replace it with an intact copy from the project's version history or a "
                + "backup.",
        },
        storyInvalidCommand: {
            title: "Invalid command",
            description: "A row the compiler refuses",
            message: "This row does not compile",
            help:
                "A row typed as a command, starting with / or #, that did not resolve to a command when it "
                + "was committed. The row keeps the text as typed, with a note saying what is missing or wrong. "
                + "Disabled rows, and rows inside a disabled row, are not reported.\n"
                + "\n"
                + "Preview and Dev Mode skip the row. A build stops before packaging while any such row is "
                + "still enabled, whatever this rule's severity.\n"
                + "\n"
                + "- Click the row to reopen its text, correct the command, and press Enter.\n"
                + "- To keep the text for later, choose Disable from the row's right-click menu.\n"
                + "- Delete the row if it is not needed.",
        },
        storyGotoMissing: {
            title: "Missing label",
            description: "A goto naming a label the scene does not declare",
            message: "Jumps to {label}, which this scene never declares",
            messageEmpty: "Names no label to go to",
            help:
                "A /goto row whose label no /label row in the same scene declares. Names must match exactly, "
                + "letter case included. A label in another scene does not count, and neither does a /label row "
                + "that is disabled or inside a disabled row. A /goto with no label chosen is reported too.\n"
                + "\n"
                + "In the game the /goto is skipped, and play continues with the row after it.\n"
                + "\n"
                + "- Choose a label in the row's Go to label field.\n"
                + "- Add a /label row with this exact name where play should land.\n"
                + "- To reach another scene, use /jump instead. A /goto only moves within its own scene.",
        },
        storyLabelDuplicate: {
            title: "Duplicate label",
            description: "Two declarations of one label; only the first is reached",
            message: "{label} is already declared above, so every /goto to it lands there and not here",
            help:
                "A /label row whose name an earlier /label row in the same scene already declares, letter "
                + "case included. The first declaration is the one that counts, and each later one is reported.\n"
                + "\n"
                + "In the game the later row is dropped, and every /goto with that name lands on the first. The "
                + "rows below the later label still play in order.\n"
                + "\n"
                + "- If the two places are meant to be different targets, rename the later label in its Label "
                + "name field and point the /goto rows meant for it at the new name.\n"
                + "- Otherwise delete the later /label row.",
        },
        storyLabelUnused: {
            title: "Unused label",
            description: "A label nothing jumps to",
            message: "Nothing jumps to {label}",
            help:
                "A /label row that no /goto in the same scene names. Only a /goto in the same scene can reach "
                + "a label, and a disabled /goto does not count. A name declared more than once is reported "
                + "once, on its first row.\n"
                + "\n"
                + "Nothing changes in the game. The row stays in the scene and has no effect.\n"
                + "\n"
                + "- Add a /goto to it where play should go back or skip ahead.\n"
                + "- Delete the row if the label is left over.\n"
                + "- If it marks a place on purpose, set the rule to Off in Project ▸ Project ▸ Project check.",
        },
        storyJumpMissing: {
            title: "Missing scene",
            description: "A jump naming a scene the project does not have",
            message: "The target scene is not set, or is not in this story",
            help:
                "A /jump row whose Target scene is not set, or names a scene this story does not have: one "
                + "since deleted, or one in another story. A jump only reaches scenes of the story it is "
                + "written in.\n"
                + "\n"
                + "In the game the jump is skipped, and play continues with the row after it.\n"
                + "\n"
                + "- Choose a scene in the row's Target scene field.\n"
                + "- To continue in another story, run a blueprint whose Start Game node starts that story from "
                + "a /blueprint row.",
        },
        storyEmptyChoice: {
            title: "Empty choice",
            description: "A choice with nothing the player can pick",
            message: "This choice has no options",
            messageEmptyOption: "This option has no text",
            help:
                "A /menu row with no enabled option under it, or an option whose text is empty. An option "
                + "whose text holds an inline value counts as having text.\n"
                + "\n"
                + "In the game a menu with no option is skipped without being shown. An option with no text is "
                + "offered with nothing written on it.\n"
                + "\n"
                + "- Add options with Add option on the menu, or enable the disabled ones.\n"
                + "- Write the option's text, or delete the option.\n"
                + "- Delete the menu if it is not needed.",
        },
        storyDeadEnd: {
            title: "Dead end",
            description: "A scene that leaves on some paths and reaches its end on another",
            message: "Play runs off the end of the scene here",
            help:
                "The scene's last row does not leave the scene, so play can run past its end. A row leaves "
                + "when it is a /jump without Return, /goto, /ending, /quit, or a /blueprint row whose "
                + "blueprint has a Start Game or Quit Game node; an /if with Else, or a /menu, leaves only when "
                + "every branch ends in one. Not reported: a scene that a jump with Return calls, and, in a "
                + "story with no /ending row, a scene with no jump at all.\n"
                + "\n"
                + "Where play runs off, the story ends and no ending is recorded. The last frame stays on "
                + "screen, or the page chosen in Page shown when the story ends opens.\n"
                + "\n"
                + "- To go on, end the path with a /jump to the next scene.\n"
                + "- To end the story here, end the path with /ending or /quit.\n"
                + "- In an /if without Else, or a menu option that runs out, add the Else branch or the closing "
                + "row.",
        },
        storyCallCycle: {
            title: "Circular call",
            description: "A returnable jump reaching a scene that can call its own back",
            message: "Calls a scene that can call this one back",
            help:
                "A /jump with Return after the target scene, whose target can call this scene back through "
                + "its own jumps with Return, directly or through other scenes. A scene that calls itself "
                + "counts. Only the jump that closes the loop is reported.\n"
                + "\n"
                + "A scene waiting for a call to return cannot be called again, so the game stops with an error "
                + "when play reaches this row.\n"
                + "\n"
                + "- Turn off Return after the target scene on this row, or on another jump in the loop, so "
                + "that the loop contains a plain jump.\n"
                + "- If the called scene jumps back here only to return, delete that jump. A called scene "
                + "returns to its caller when it reaches its end.",
        },
        storyUnreachableScene: {
            title: "Unreachable scene",
            description: "A scene nothing can reach from the start",
            message: "Nothing reaches this scene",
            help:
                "No path leads to this scene from where play begins. Play begins at the story's entry scene "
                + "and at any scene a Start Game node in a blueprint starts, and goes on only through /jump "
                + "rows that are not disabled. A story with no entry scene, which no Start Game starts either, "
                + "is not checked.\n"
                + "\n"
                + "No player sees the scene.\n"
                + "\n"
                + "- Add a /jump to it from a scene play reaches, or drag between the two scenes in Scene Flow.\n"
                + "- If play should start here, choose Set as Entry Scene from Scene actions in the story "
                + "panel, or point a Start Game node at it.\n"
                + "- If the scene is a draft kept on purpose, set the rule to Off in Project ▸ Project ▸ "
                + "Project check.",
        },
        storyEmptyScene: {
            title: "Empty scene",
            description: "A scene with no content",
            message: "This scene has no enabled rows",
            help:
                "The scene has no rows that play: it is empty, or every row in it is disabled.\n"
                + "\n"
                + "Play that arrives here has nothing to run. A plain jump to the scene ends the story there, "
                + "and a jump with Return comes straight back.\n"
                + "\n"
                + "- Write the scene, or enable its rows.\n"
                + "- If the scene is not needed, delete it together with the jumps that lead to it.\n"
                + "- To keep it as a placeholder, set the rule to Off in Project ▸ Project ▸ Project check.",
        },
        storyAppTagUnknown: {
            title: "Unknown build variant",
            description: "A row compared with a variant the project does not have",
            message: "No build variant is named \"{name}\", so this comparison has the same result in every build",
            help:
                "An expression on this row compares AppTag with a name, as in AppTag == \"Demo\" or AppTag != "
                + "\"Demo\", and no build variant has that name. Names must match exactly, letter case included. "
                + "Renaming or deleting a variant does not change the rows that name it.\n"
                + "\n"
                + "The comparison then has the same result in every build: == is always false and != always "
                + "true. Content behind an == test is in no build.\n"
                + "\n"
                + "- Change the name to a variant listed in Project ▸ App ▸ Build variants.\n"
                + "- If the variant was deleted on purpose, remove the comparison, or the content that depended "
                + "on it.",
        },
        storyRowsAfterEnding: {
            title: "Rows after an ending",
            description: "Rows written after an /ending row in the same list, which never play",
            // States the consequence, not the mistake: the rows are already gone from the build, and
            // an author reading this needs to know that before they know why.
            message: "This row comes after an ending and is never played. Move it before the ending, or delete it",
            help:
                "A row written after an /ending or /quit row in the same list, that is, the scene's top level "
                + "or the inside of one branch or group. Each list is reported once, on the first such row. A "
                + "row after an /if whose branch holds the ending is not reported, since whether it plays "
                + "depends on the branch taken.\n"
                + "\n"
                + "The rows after the ending are left out of the game and never play.\n"
                + "\n"
                + "- Move the rows above the ending if they should play first.\n"
                + "- If the story should end only in some cases, put the ending inside an /if branch.\n"
                + "- Otherwise delete the rows.",
        },
        storyQuitPageMissing: {
            title: "Quit with no page",
            description: "A /quit row that names no page, or one the project no longer has",
            // Two sentences, both states: what the row does now, and what the player is left with.
            message: "This row names no page, so no page opens and the rows after it in this list never play",
            deleted: "This project has no page \"{page}\", so the playthrough ends with nothing on screen",
            help:
                "A /quit row (Quit to page) whose Page shown afterwards is not set, or names a page this "
                + "project no longer has.\n"
                + "\n"
                + "With no page set, the row opens nothing, and the rows after it in the same list never play. "
                + "With a deleted page, the playthrough ends and no page opens.\n"
                + "\n"
                + "- Choose a page in the row's Page shown afterwards field.\n"
                + "- To end the story with an ending recorded, use an /ending row instead.",
        },
        storyEndingNameDuplicate: {
            title: "Two endings with one name",
            description: "More than one ending sharing a display name",
            // Says where it shows, because nothing about the story itself is wrong.
            message: "Another ending is also called \"{name}\". A screen listing endings shows the name twice",
            help:
                "An /ending row whose Ending name an earlier /ending row in the same story already uses. The "
                + "later row is reported, and unnamed endings are not compared.\n"
                + "\n"
                + "The game keeps the two endings apart and records each on its own. Only the name repeats, so "
                + "a screen that lists endings shows it twice with no way to tell them apart.\n"
                + "\n"
                + "- Give the later ending a different name in its Ending name field.\n"
                + "- If both should read the same, set the rule to Off in Project ▸ Project ▸ Project check.",
        },
        storyCutPointOrphan: {
            title: "Cut point with no variant",
            description: "A cut point written while the project has no build variant",
            // The row is inert rather than wrong, so the sentence says what it does now, not what
            // the author did. Both remedies are in it because either one is a complete answer.
            message: "This project has no build variant, so this cut point ends nothing. Add a variant, or delete the row",
            help:
                "A cut point row in a project that has no build variant. A cut point ends only the build of "
                + "the variant it names, so this row has nothing to end. Deleting the last variant leaves "
                + "existing cut point rows in this state.\n"
                + "\n"
                + "The row has no effect, and every build contains the rows after it.\n"
                + "\n"
                + "- Add a variant in Project ▸ App ▸ Build variants, then choose it in the row's Build variant "
                + "field.\n"
                + "- Delete the row if no variant should end here.",
        },
        storyCutPointUnreachable: {
            title: "Cut point out of reach",
            description: "A cut point in a scene nothing can get to",
            message: "Nothing can reach this scene, so this cut point never ends a build",
            help:
                "A cut point row in a scene no path reaches from where play begins: the story's entry scene "
                + "and any scene a Start Game node starts, followed through /jump rows that are not disabled.\n"
                + "\n"
                + "No playthrough passes this row, so it never ends the build of the variant it names. That "
                + "build contains every scene the story reaches, as if the row were not there.\n"
                + "\n"
                + "- Make the scene reachable with a /jump from a scene play reaches.\n"
                + "- Or move the cut point into the scene where that variant should end.\n"
                + "- Delete the row if it is no longer needed.",
        },
        storyStageObjectMissing: {
            title: "Missing stage object",
            description: "A row acting on an object no row in the scene creates",
            message: "No row in this scene creates {object}, so this row has nothing to act on",
            // A character is not created, it walks on - so the remedy is the one word that changes.
            messageCharacter: "No row in this scene brings {object} on stage, so this row has nothing to act on",
            help:
                "The row acts on a stage object that no row in this scene creates. Only rows in the same "
                + "scene count, since stage objects do not carry over from another scene, and names must match "
                + "exactly.\n"
                + "\n"
                + "In the game the row has nothing to act on and does nothing.\n"
                + "\n"
                + "- Add the row that creates it in this scene, above this one: /image, /text, /layer, /vfx, "
                + "/play or /sound, or /show for a character.\n"
                + "- If the row should act on an object that exists, choose that object in the row's inspector.\n"
                + "- Correct the name if it is misspelled.",
        },
        storyDeclaredNeverShown: {
            title: "Unshown stage object",
            description: "A create row declares an object no row shows",
            message: "{object} is declared here and no row shows it",
            help:
                "An /image, /text or /vfx row declares an object, and no /show row in this scene reveals it. "
                + "A declared object stays hidden until a /show in the same scene names it. /show naming an "
                + "asset, and /play, declare and show in one row and are not reported.\n"
                + "\n"
                + "The player never sees the object, and the row has no visible effect.\n"
                + "\n"
                + "- Add a /show with the object's name in this scene, where it should appear.\n"
                + "- For an image that should appear at once, replace the row with a /show naming the asset.\n"
                + "- Delete the row if the object is not needed.",
        },
        storyStageObjectDuplicate: {
            title: "Duplicate stage object",
            description: "Two rows creating one stage name; the second reuses the first",
            message: "{object} is already created above, so this row acts on that one",
            help:
                "A row creates a stage object under a name that an earlier row in this scene already created: "
                + "an image, a text, a layer, an ambience effect, or a video played from a different file. "
                + "Characters and sounds are not reported, since showing or playing them again is ordinary.\n"
                + "\n"
                + "The later row reuses the first object. Its own image, text and other settings are not "
                + "applied, and for a video the first row's file plays.\n"
                + "\n"
                + "- If two objects were meant, give this row a different name.\n"
                + "- To change the first object's image or text, use /swap on it instead.\n"
                + "- Otherwise delete this row.",
        },
        storyVideoControlAfterEnd: {
            title: "Video already finished",
            description: "A row pausing, resuming, seeking or stopping a video after a play that waits for its end",
            message: "{object} has already finished playing at this line; to continue while it plays, turn off “Wait for the video” on its play row",
            help:
                "A /pause, /resume, /seek or /stop row aimed at a video whose /play row, earlier in the same "
                + "run of rows, waits for the video to finish, with nothing between them playing it again. Rows "
                + "inside a /parallel, /race, /repeat or /until group, rows in different branches, and rows "
                + "with a /label between them are not reported.\n"
                + "\n"
                + "By the time this row runs the video has already finished, so the row does nothing.\n"
                + "\n"
                + "- To let the rows in between run while the video plays, turn off Wait for the video on its "
                + "/play row.\n"
                + "- If the video should play to its end first, delete this row.",
        },
        storyCharacterMissing: {
            title: "Missing character",
            description: "A row naming a character the project does not have",
            // No subject in the sentence: an unresolved reference leaves only its stored id, which
            // is a UUID, and a UUID in a report is a word nobody can search a project for.
            message: "This row names a character the project does not have",
            help:
                "The row names a character the project does not have: a character row such as /show, /hide or "
                + "/char, or an Expression change inside a line of text. A dialogue line's speaker is not "
                + "checked here.\n"
                + "\n"
                + "In the game the row reaches no character, so nothing appears or changes.\n"
                + "\n"
                + "- Choose a character in the row's Character field.\n"
                + "- For an Expression change inside a line, remove it and insert it again for a character the "
                + "project has.\n"
                + "- Delete the row if it is not needed.",
        },
        storyTransitionUnavailable: {
            title: "Unavailable transition",
            description: "A row naming a transition this version cannot play",
            // The stored word is printed even though no picker offers it any more: it is the only
            // handle the author has on a transition that is otherwise gone from every menu.
            message: "The transition {transition} is not available, so this change plays as a cut",
            help:
                "The row names a transition this version of Studio cannot play, and the message shows the "
                + "name as it is stored. Such a row was saved by a newer Studio, names a transition that has "
                + "since been removed, or uses a custom transition.\n"
                + "\n"
                + "In the game this change plays as a cut, with no transition.\n"
                + "\n"
                + "- Choose a transition in the Transition section of the row's inspector.\n"
                + "- If a newer NarraLeaf Studio saved the row, use that version.",
        },
        storyBackgroundUnchanged: {
            title: "Unchanged background",
            description: "A row transitioning to the background already on screen",
            message: "This background is already on screen, so the transition changes nothing",
            help:
                "A /bg row with a transition sets the background already on screen at this row: the same "
                + "image or color, whether from an earlier /bg row or from the scene's Default background. Rows "
                + "that change as a cut, rows after a /transform on the background, and rows naming no image or "
                + "color are not reported.\n"
                + "\n"
                + "The player watches the transition run its full length with no visible change.\n"
                + "\n"
                + "- If the row is there to fix the background, for a scene entered from several places, remove "
                + "its transition. A cut takes no time.\n"
                + "- Otherwise delete the row, or choose a different image.",
        },
        blueprintReferenceMissing: {
            title: "Missing target",
            description: "A node naming something the project no longer has",
            // The generic fallback; every kind the rule can resolve has a sentence of its own
            // below, because "something" is exactly the word an author cannot act on.
            message: "Names something the project no longer has",
            messageSurface: "Opens a page that no longer exists",
            messageStory: "Starts a story that no longer exists",
            messageScene: "Names a scene that no longer exists",
            messageChoice: "Names a choice that no longer exists",
            messageEnding: "Names an ending that no longer exists",
            messageCharacter: "Names a character that no longer exists",
            messageTextKey: "Names a translation key the project does not declare",
            messageDlc: "Names a DLC the project does not have",
            messageInputAction: "Names an input action the project does not declare",
            help:
                "A node names a page, story, scene, choice, ending, character, translation key, DLC or input "
                + "action that the project no longer has, usually after it was deleted, or after the node was "
                + "pasted from another project. Only a value picked on the node is checked: a node whose input "
                + "of the same name is wired, or that has nothing picked, is not reported.\n"
                + "\n"
                + "When the node runs, it finds nothing under that name. Go Page and Show Layer stop without "
                + "opening a page, Start Game does not start, a check such as Is DLC Installed answers false, "
                + "and an On Action head never runs.\n"
                + "\n"
                + "- Pick something the project has in the node's field.\n"
                + "- Delete the node if it is no longer needed.",
        },
        blueprintElementRefMissing: {
            title: "Missing widget",
            description: "A node bound to a widget the project no longer has",
            message: "Bound to a widget that no longer exists",
            help:
                "An Element, Element Click or Element Flush node is bound to a widget the project no longer "
                + "has. The widget was deleted while blueprints still named it, or the node was pasted from "
                + "another project.\n"
                + "\n"
                + "The binding does nothing in the game: Element Click and Element Flush never run, and nodes "
                + "that read the Element have no widget to act on.\n"
                + "\n"
                + "- Bind the node to a widget the project has. On an Element card, click the box that reads "
                + "Missing element.\n"
                + "- Delete the node if it is no longer needed.",
        },
        blueprintFnTargetMissing: {
            title: "Missing function",
            description: "A Call Fn node whose function does not exist in its scope",
            // The fallback, for a call stored without a signature snapshot: all that is left of the
            // target then is its ref, which is a pair of ids - and an id in a report is a word
            // nobody can search a project for.
            message: "Calls a function that does not exist in this scope",
            messageNamed: "Calls {name}, which does not exist in this scope",
            help:
                "A Call Fn node calls a function this blueprint cannot reach: the function was deleted, or "
                + "the call was copied from a blueprint that can reach it. A function on App logic can be "
                + "called from every blueprint, one on a page or on a widget of that page only from that page, "
                + "and one in a component only from inside that component. A Call Fn with no function picked is "
                + "not reported.\n"
                + "\n"
                + "When a chain reaches the call, it stops there, and nothing wired after it runs.\n"
                + "\n"
                + "- On the Call Fn node, pick a function under Function. The list shows only the functions "
                + "this blueprint can call.\n"
                + "- To call one function from several pages, create it on App logic.\n"
                + "- Delete the node if the call is no longer needed.",
        },
        blueprintUnreachableNode: {
            title: "Unreachable node",
            description: "A node no entry point in its graph can reach",
            message: "Nothing reaches this node, so it never runs",
            help:
                "A node with an execution input that nothing leads to: no event head or Fn node in its layer "
                + "reaches it along the wires that set the order of execution. Only the first node of such a "
                + "chain is reported. Nodes that only produce values, and layers with no event head or Fn node "
                + "at all, are not reported.\n"
                + "\n"
                + "The node and every node wired after it never run.\n"
                + "\n"
                + "- Wire it into the order of execution from an event head or from a node that runs.\n"
                + "- Delete the chain if it is left over from earlier work.",
        },
        blueprintDlcEntranceUnguarded: {
            title: "Unguarded DLC entrance",
            description: "A Start Game node starting a DLC's story, with nothing asking whether the DLC is installed",
            message: "No Is DLC Installed in this layer asks about this story's DLC",
            help:
                "A Start Game node picks a story that belongs to a DLC (the story's Belongs to names the "
                + "DLC), and its layer has no Is DLC Installed node set to that DLC. Only the layer the Start "
                + "Game node is in is looked at, and a story passed in by a wire is not checked.\n"
                + "\n"
                + "Dev Mode carries every story, so the control works there. In a released game without the "
                + "DLC, the story is not in the game and starting it fails.\n"
                + "\n"
                + "- In the same layer, add Is DLC Installed for that DLC and test its answer, for example with "
                + "If, before Start Game.\n"
                + "- If the check is made elsewhere, such as a menu that hides the entry while the DLC is "
                + "missing, set this rule to Off in Project ▸ Project ▸ Project check.",
        },
        blueprintEmptyEvent: {
            title: "Empty event",
            description: "An event layer with nothing wired to run",
            message: "This event runs nothing",
            help:
                "A layer that runs nothing: it has no nodes, or nothing is wired to run after any of its "
                + "event heads. A layer that has nodes but no event head is reported by the blueprint editor "
                + "instead.\n"
                + "\n"
                + "When the event happens, nothing runs. A button whose Mouse Click layer is empty does nothing "
                + "when pressed.\n"
                + "\n"
                + "- Wire the nodes that should run after the event head.\n"
                + "- Delete the layer with Delete layer… in the Layers list if it is not needed.",
        },
        blueprintUnknownNode: {
            title: "Unknown node type",
            description: "A node whose type the project cannot load",
            // Names the type, because the locator points at the graph and the node but a node id is
            // not something the author can act on - the type is what says which plugin is missing.
            message: "{type} is not loaded, so this node will not run in the game",
            help:
                "A node's type comes from a plugin that is not loaded in this project: it is uninstalled, "
                + "disabled, off for this project, or failed to load. The canvas shows the node as Unknown node "
                + "and keeps its settings and connections.\n"
                + "\n"
                + "The node does not run in the game, and a chain that reaches it stops there.\n"
                + "\n"
                + "- Install or enable the plugin in the plugins panel. Project ▸ App ▸ Dependencies lists the "
                + "plugins this project uses and the state of each.\n"
                + "- Delete the node if the plugin is no longer used.",
        },
        blueprintAssembledAssetName: {
            title: "Asset name assembled at run time",
            description: "An asset is chosen by a name the game puts together while it runs, and the game package does not carry it",
            // The one sentence every surface prints about this: the canvas, the build and the delete
            // dialog render these keys too. `{node}`, `{pin}`, `{prop}` and a node `{origin}` arrive in
            // the reader's language, named the way the canvas and the inspector name them.
            message: "\"{pin}\" on \"{node}\" receives an asset name assembled at run time (from \"{origin}\"). A game package carries only the assets whose names are written in the project, so nothing will be there in the released game. Choose the asset in the asset picker, or read one already chosen from a list row or a variable",
            messageBinding: "\"{prop}\" on \"{element}\" is bound to an asset name assembled at run time (from \"{origin}\"). A game package carries only the assets whose names are written in the project, so nothing will be there in the released game. Choose the asset in the asset picker, or read one already chosen from a list row or a variable",
            // The same two places, where the name comes from a node type nothing here can load.
            // `{origin}` is the node type rather than a title: it is what names the plugin, the way
            // `blueprintUnknownNode` names it.
            messageUnloadedNode: "\"{pin}\" on \"{node}\" receives an asset name from {origin}, which is not loaded, so the asset it names will not be in the released game. Install or switch on the plugin that provides this node type, then build again",
            messageUnloadedNodeBinding: "\"{prop}\" on \"{element}\" is bound to an asset name from {origin}, which is not loaded, so the asset it names will not be in the released game. Install or switch on the plugin that provides this node type, then build again",
            help:
                "An asset input, on a node or on a widget property bound to a Blueprint Value, receives a "
                + "name the game puts together while it runs: text built with Concat or Format, typed by the "
                + "player, or received from a server, directly or through a variable, a list row, a function or "
                + "page props. A name that comes from a node whose plugin is not loaded is reported too.\n"
                + "\n"
                + "A game package carries only the assets whose names are written in the project, so the asset "
                + "is missing from the released game. Dev Mode carries every asset and shows it. A build is "
                + "refused while this stands, whatever this rule is set to.\n"
                + "\n"
                + "- Choose the asset in the asset picker.\n"
                + "- Where the asset has to vary, keep assets chosen in the picker in a list row or a variable, "
                + "and read the asset from there.\n"
                + "- For a name from a plugin's node, install or enable the plugin in the plugins panel, then "
                + "build again.",
        },
        uiPageUnreachable: {
            title: "Unreachable page",
            description: "A page nothing opens, embeds, or starts on",
            message: "Nothing opens this page",
            help:
                "A page nothing opens: it is not the entry page, no blueprint node picks it (Go Page, Show "
                + "Layer and Quit Game are examples), and no Page widget shows it. Game UI is not checked.\n"
                + "\n"
                + "No player can open the page.\n"
                + "\n"
                + "- Open it from a blueprint: add Go Page, or Show Layer to show it over the current page, and "
                + "pick this page.\n"
                + "- Show it inside another page with a Page widget.\n"
                + "- If the game should start on it, use Set as Entry Page on it.\n"
                + "- Delete the page if it is not needed.",
        },
        uiEmptyBehavior: {
            title: "Button with no handler",
            description: "A clickable widget nothing listens to",
            message: "Nothing runs when this is clicked",
            help:
                "A button on a page that runs nothing when pressed. Nothing answers its click: no Mouse Click "
                + "head in its own blueprint or in that of a widget containing it, no Element Click head naming "
                + "it, and no Item Click head on a list it sits in. Buttons with Interaction disabled, and "
                + "buttons inside a component, are not checked.\n"
                + "\n"
                + "The player can press the button and nothing happens.\n"
                + "\n"
                + "- Open the button's blueprint from its properties, add a Mouse Click head, and wire what "
                + "should run after it.\n"
                + "- If the button should take no clicks, turn on Interaction disabled under Behavior.",
        },
        uiUnknownWidget: {
            title: "Unknown widget type",
            description: "A widget whose type the project cannot load",
            // Names the type, for the reason `blueprintUnknownNode` does: the locator points at the
            // page and the element, and the type is what says which plugin is missing.
            message: "{type} is not loaded, so this widget will not be drawn in the game",
            help:
                "A widget's type comes from a plugin that is not loaded in this project: it is uninstalled, "
                + "disabled, off for this project, or failed to load. The canvas draws it as Unknown widget and "
                + "keeps its settings.\n"
                + "\n"
                + "In the game the widget is not drawn. A warning box naming its type takes its place, and "
                + "widgets inside it are still drawn.\n"
                + "\n"
                + "- Install or enable the plugin in the plugins panel. Project ▸ App ▸ Dependencies lists the "
                + "plugins this project uses and the state of each.\n"
                + "- Delete the widget if the plugin is no longer used.",
        },
        uiComponentMissing: {
            title: "Missing component",
            description: "An instance of a component the project does not have",
            message: "This instance points at a component the project does not have",
            help:
                "A placement of a component that is not in the Component Library: the component was deleted "
                + "while placements remained, or the placement was pasted from another project.\n"
                + "\n"
                + "The placement draws a placeholder box instead of the component, on the canvas and in the "
                + "game.\n"
                + "\n"
                + "- Delete the placement, and place a component from the Component Library in its place.\n"
                + "- If the component was deleted by mistake, undo the deletion.",
        },
        uiFrameTargetMissing: {
            title: "Missing embedded page",
            description: "A Page widget embedding a page the project does not have",
            message: "This Page widget embeds a page the project does not have",
            help:
                "A Page widget's Page names a page the project does not have: the page was deleted while this "
                + "widget still showed it, or the widget was pasted from another project. A Page widget with no "
                + "page chosen is not reported. One inside a component is reported once, under the component.\n"
                + "\n"
                + "The Page widget draws a placeholder box instead of a page, on the canvas and in the game.\n"
                + "\n"
                + "- Select the Page widget and choose a page under Page.\n"
                + "- Delete the Page widget if nothing should be shown there.",
        },
        uiFrameLoop: {
            title: "Circular embedded page",
            description: "A Page widget embedding a page that leads back to it",
            message: "This Page widget embeds a page that leads back to it",
            help:
                "A Page widget shows a page that, through its own Page widgets or the components placed on "
                + "it, draws this Page widget again. Every Page widget on the loop is reported where it is.\n"
                + "\n"
                + "The game draws a placeholder box where the loop closes. Which Page widget gets it depends on "
                + "which page the player opens first.\n"
                + "\n"
                + "- On one Page widget of the loop, choose another page under Page. In the page picker, a page "
                + "marked leads back here would close the loop again.\n"
                + "- Or delete one Page widget of the loop.",
        },
        uiListItemFieldMissing: {
            title: "Missing item field",
            description: "A widget bound to an item field the list drawing it does not declare",
            message: "This is bound to an item field the list does not declare, so every row shows the same value",
            help:
                "A widget shows an item field that the list drawing it does not declare: the field was "
                + "removed from the list's Fields, the list was given other fields, or the widget was pasted "
                + "from a list with different fields. A widget bound to an item field that is not inside any "
                + "list is reported too.\n"
                + "\n"
                + "The widget shows the value it was written with instead of each row's, so every row shows the "
                + "same thing.\n"
                + "\n"
                + "- Select the widget and choose a field the list has under Field, or No field.\n"
                + "- Or add the field to the list's Fields, under Edit content.\n"
                + "- A widget outside every list: move it back into a list's Item template, where Field can be "
                + "changed, or delete it.",
        },
        uiComponentParamMissing: {
            title: "Missing text parameter",
            description: "A widget in a component showing a parameter the component does not declare as text",
            message: "This shows a parameter the component does not declare as text, so every placement shows no words here",
            messageOutside: "This shows a component parameter but is not inside a component, so the game shows no words here",
            help:
                "A text or button inside a component shows a parameter, chosen under Parameter, that the "
                + "component does not declare as a Text parameter: it was removed or changed to String, or the "
                + "widget was copied from another component. A text or button on a page that shows a component "
                + "parameter, usually pasted out of a component, is reported too.\n"
                + "\n"
                + "Every placement of the component shows no words in that widget, while the component editor "
                + "still draws its sample text. On a page, the game shows no words there.\n"
                + "\n"
                + "- In the component's Params, add a Text parameter, or set the parameter's Type to Text.\n"
                + "- Select the widget and choose a Text parameter under Parameter, or No parameter to show its "
                + "own words.\n"
                + "- On a page there is no parameter to show: delete the widget and place a new one with words "
                + "of its own.",
        },
        uiListTextUntranslated: {
            title: "Untranslated list content",
            description: "Words written into a list's content in a project that has a second language",
            message: "{text} and the rest of this list's content show as written in every language",
            help:
                "In a project with a second language, a List on a page shows rows written into its own "
                + "content, and a text in its Item template shows words from those rows. Those words have no "
                + "row in the translation table. Each list is reported once, with its first such words. Lists "
                + "whose Runtime items is not List content, and lists that a blueprint fills or refers to, are "
                + "not reported.\n"
                + "\n"
                + "The rows show the words as written, in every language.\n"
                + "\n"
                + "- For words that should follow the language, fill the rows from the list's blueprint with "
                + "Set List Content, taking the words from Translation Key Text.\n"
                + "- For words that read the same in every language, such as character names, set this rule to "
                + "Off in Project ▸ Project ▸ Project check.",
        },
        uiLocalizationKeyMissing: {
            title: "Missing translation key",
            description: "A widget reading its words from a key the project does not have",
            message: "Reads its words from {key}, which the project does not have",
            help:
                "A widget's words are set to Translation key, and the key it names is not in the project. "
                + "Removing a key in Studio gives its widgets the key's words, so this usually follows a change "
                + "made to the project's files outside Studio. Texts, buttons and the Text parameters of "
                + "component placements are checked, on pages and inside components.\n"
                + "\n"
                + "In the game the widget shows the key's name in place of its words.\n"
                + "\n"
                + "- Under Translation key, pick a key the project has.\n"
                + "- Or use Create new key… to create a key with this name, and write its source text.\n"
                + "- Or choose Direct and write the words on the widget.",
        },
        uiGestureAnsweredTwice: {
            title: "Gesture answered twice",
            description: "A widget with a pointer handler of its own, on a page whose action answers the same gesture",
            message: "{action} on this page answers the same gesture this widget does, so both run",
            help:
                "The page answers an input action bound to a mouse gesture (click, double click, right click "
                + "or the wheel), and a widget on the page answers the same gesture with a head of its own: "
                + "Mouse Click, Mouse Double Click, Right Click or Mouse Wheel. The widget is not a control "
                + "such as a button, and is not inside one. Over a control, the page's action does not fire.\n"
                + "\n"
                + "One gesture on the widget runs both its own head and the page's action. That can be "
                + "intended, such as a click that plays a sound on the widget and also advances the page.\n"
                + "\n"
                + "- If only the widget should answer, place it inside a Button, or use a Button in its place.\n"
                + "- If only the page should answer, remove the head from the widget's blueprint.\n"
                + "- If both should answer, set this rule to Off in Project ▸ Project ▸ Project check.",
        },
        blueprintSaveFieldEmpty: {
            title: "Empty save field",
            description: "A Save Game node that will run with a declared save field left empty",
            message: "{field} is empty, so this save is written with its default instead",
            help:
                "A Save Game node that will run leaves one of the project's save fields empty: the field's "
                + "pin on the node has no wire and no value typed on the card. A value typed on the card counts "
                + "even when it is empty text. Save fields are declared under Save fields on a save node's "
                + "card, and every Save Game node has a pin for each of them.\n"
                + "\n"
                + "The save is written with the field's default, and a save screen that reads the field through "
                + "Get Save Metadata shows the default for that slot.\n"
                + "\n"
                + "- Wire the value into the field's pin on Save Game, or type it on the card.\n"
                + "- If the field is no longer used, remove it under Save fields.",
        },
        blueprintRequiredInputUnwired: {
            title: "Empty input",
            description: "A node that will run with a required input left unconnected",
            // Names the node and the pin: the locator column points at the blueprint, and the node
            // behind it is a generated id nothing on the interface shows.
            message: "{node} has nothing connected to {pin}",
            help:
                "A node that will run has a required input with no wire and no value typed on the card. A "
                + "node will run when an event head leads to it, or when a node that runs reads its output. "
                + "Inputs the node marks optional are not reported, and where either of two inputs will do, the "
                + "pair is reported once.\n"
                + "\n"
                + "When the node runs, the input has no value. Depending on the node, it does nothing, as Set "
                + "Text with no Element does, or the chain stops at it.\n"
                + "\n"
                + "- Wire a value into the pin, or type one on the card.\n"
                + "- If the node should not run, disconnect it from the chain or delete it.",
        },
        blueprintStartSceneForeign: {
            title: "Scene from another story",
            description: "A Start Game node whose scene is not in the story it names",
            message: "This scene is in {owner}, not in {story}, so the game cannot start from it",
            help:
                "A Start Game node's Scene belongs to another story than the one its Story names, for example "
                + "after the Story was changed on a node whose Scene was already picked. A node with a wire "
                + "into Story or Scene is not checked, and a story or scene the project no longer has is "
                + "reported as a missing target instead.\n"
                + "\n"
                + "When the node runs, the story cannot start from that scene, and the game does not start.\n"
                + "\n"
                + "- On the Start Game node, pick the Scene again. The list shows only the scenes of the chosen "
                + "Story.\n"
                + "- Or pick, as the Story, the one the message names as holding the scene.",
        },
        variablesUndeclared: {
            title: "Undeclared variable",
            description: "A variable used without a declaration",
            message: "{variable} is used but never declared",
            help:
                "A row reads or sets a variable that is not declared where the row is. A scene variable needs "
                + "a /local row in the same scene; a saved or persistent variable needs an entry in the "
                + "Variables panel. Disabled rows are not checked.\n"
                + "\n"
                + "In the game the variable has no value there: a row that sets it is skipped, and anything "
                + "that reads it gets no value.\n"
                + "\n"
                + "- The variable was deleted: undo the deletion, or declare a new one and select it again in "
                + "each row that uses it. A new variable with the same name is not picked up by itself.\n"
                + "- The row came from another scene: a /local variable belongs to its own scene. Declare one "
                + "here with /local, or use a saved variable, and select it again in the row.",
        },
        variablesUnused: {
            title: "Unused variable",
            description: "A variable declared but never read or written",
            message: "{variable} is declared but never used",
            help:
                "No row and no blueprint reads or sets this declared variable, disabled rows included. A "
                + "/local variable counts only the rows of its own scene; a saved or persistent variable counts "
                + "every story. A variable from the Variables panel is reported against the project.\n"
                + "\n"
                + "Nothing in the game depends on it.\n"
                + "\n"
                + "- If it is left over, remove its /local row, or use Delete variable in the Variables panel.\n"
                + "- Rows in other scenes cannot use a /local variable. For a value several scenes share, use a "
                + "saved variable.\n"
                + "- If it is declared ahead of rows still to be written, set the rule to Off in Project ▸ "
                + "Project ▸ Project check.",
        },
        variablesNameCollision: {
            title: "Variable name collision",
            description: "One name declared in two places",
            message: "{variable} is declared twice as a persistent variable",
            help:
                "One name belongs to two different saved variables, or two different persistent variables: "
                + "one defined in the Variables panel and one declared by a row in a story.\n"
                + "\n"
                + "Each row that uses the name is bound to one of the two, and the name does not say which, so "
                + "rows that seem to share a value can read and write separate ones.\n"
                + "\n"
                + "- Rename one of them: the variable in the Variables panel, or the declaration row.\n"
                + "- If they are meant to be one variable, delete the declaration row and select the remaining "
                + "variable again in the rows that used it.",
        },
        variablesConditionNeverHolds: {
            title: "Condition no path can satisfy",
            description: "A condition whose variable can never reach the value it tests for",
            message: "{variable} is always within {bound} here, so this condition cannot hold",
            help:
                "No value the variable can have at this row makes the condition true. Only comparisons of a "
                + "number variable with a written number are checked, such as affection >= 50. The range in the "
                + "finding counts the variable's default and every change the story can make before this row.\n"
                + "\n"
                + "In the game the condition is always false: an /if branch never runs, an /until never ends "
                + "its loop, and an option is never hidden or disabled by it.\n"
                + "\n"
                + "- Change the number the condition asks for, or what the routes leading here add, so that the "
                + "condition can hold.\n"
                + "- In Scene Flow, choose the variable in the list showing No variable focus: each scene then "
                + "shows the range it is reached with, and each branch what it adds.\n"
                + "- If the condition is meant never to hold, set the rule to Off in Project ▸ Project ▸ "
                + "Project check.",
        },
        variablesReadNeverWritten: {
            title: "Condition nothing can change",
            description: "A variable a condition tests, that nothing in the project ever assigns",
            message: "{variable} is tested by {conditions} but nothing ever sets it",
            conditionCount: {
                one: "{count} condition",
                other: "{count} conditions",
            },
            help:
                "A condition tests a variable that nothing in the project sets: no /set, /inc, /dec or "
                + "/toggle row in any story, even a disabled one, and no blueprint node that sets it. "
                + "Conditions are /if, /until, and a choice option's Hidden when and Disabled when; the finding "
                + "is on the first and counts them all.\n"
                + "\n"
                + "The variable keeps its default value throughout the game, so every one of these conditions "
                + "gives the same answer every time.\n"
                + "\n"
                + "- Add the row that sets it where the story calls for it, for example /set met true after the "
                + "scene that introduces the character.\n"
                + "- If a blueprint is meant to set it, add Set Scene Var, Set Saved Var or Set Persistent for "
                + "it there.\n"
                + "- If the variable is a switch changed only through its default value, such as a debug flag, "
                + "set the rule to Off in Project ▸ Project ▸ Project check.",
        },
        variablesRandomOutsideAssignment: {
            title: "Random outside an assignment",
            description: "A random value somewhere it is re-rolled instead of kept",
            message: "{fn}() is re-rolled every time this condition is tested, so the branch can change between checks. Roll it once with /set, then test that variable",
            messageChoiceOption: "{fn}() is re-rolled every time the menu draws, so this option flickers. Roll it once with /set, then test that variable",
            messageInterpolation: "{fn}() is re-rolled every time this line draws, so the value changes on every redraw. Roll it once with /set, then show that variable",
            help:
                "random() or randomInt() is called where its result is worked out again each time it is used: "
                + "an /if condition, a choice option's Hidden when or Disabled when, or the text of a line, "
                + "prompt or option. Calls on the right of /set, /inc and /dec, and in /until, are not "
                + "reported.\n"
                + "\n"
                + "In the game the result keeps changing: an /if can take a different branch each time it is "
                + "tested, an option flickers while the menu is shown, and a shown number changes whenever the "
                + "line is redrawn.\n"
                + "\n"
                + "- Roll once into a variable above the row, for example /local roll 0 then /set roll "
                + "randomInt(1, 6), and use roll where the call was. Use a saved variable instead when the "
                + "result must outlast the scene.\n"
                + "- If a value that changes on every redraw is intended, set the rule to Off in Project ▸ "
                + "Project ▸ Project check.",
        },
        textOverlong: {
            title: "Overlong line",
            description: "A line wider than the dialogue box holds",
            message: "{width} columns wide, over {max}",
            help:
                "The line is wider than the project's maximum, 120 columns unless changed. The whole line is "
                + "counted, however the box wraps it: a Chinese, Japanese or Korean character is two columns "
                + "and any other character one, while inserted values, pauses and inline events count as "
                + "nothing. Only source-language narration, dialogue, prompts and options are checked.\n"
                + "\n"
                + "A line over the maximum may not fit the dialogue box, menu or choice button it appears in.\n"
                + "\n"
                + "- Split it into two rows, or shorten it.\n"
                + "- If the dialogue box holds a different amount, change Maximum width under this rule in "
                + "Project ▸ Project ▸ Project check. Counting, below it, can count every character as one "
                + "column.",
        },
        textEmpty: {
            title: "Empty line",
            description: "A narration, dialogue or choice option row with no text",
            message: "This line has no text",
            help:
                "A narration, dialogue or choice option row has no text: nothing but spaces, with no inserted "
                + "value and no inline event. A choice without a prompt is not reported, nor is a disabled row.\n"
                + "\n"
                + "In the game a blank narration or dialogue row is skipped and shows nothing. A blank choice "
                + "option is still offered, labeled with the placeholder Option or with nothing.\n"
                + "\n"
                + "- Write the text the row was meant to have, or delete the row.",
        },
        localizationMissing: {
            title: "Missing translation",
            description: "A line or interface text with no translation in a target language",
            message: "No {locale} translation",
            messageInterface: "No {locale} translation of {text}",
            help:
                "A line or a piece of interface text has no translation in one of the project's languages. "
                + "Every language in the Localization panel other than the source language is checked, against "
                + "narration, dialogue, prompts, options and the interface text of the translation table. A "
                + "translation key is reported once, however many widgets use it.\n"
                + "\n"
                + "Players of that language see the fallback language's translation, or the source text when "
                + "there is none.\n"
                + "\n"
                + "- Open the language in the Localization panel and write the translation. The Untranslated "
                + "filter lists every missing one; interface text is under Interface text in the Source list.\n"
                + "- To translate elsewhere, use Export translations… in the language's More menu with Include "
                + "set to Untranslated and to review, then Import translations… with the result.\n"
                + "- If a language is not meant to be complete, set the rule to Off in Project ▸ Project ▸ "
                + "Project check.",
        },
        localizationStale: {
            title: "Stale translation",
            description: "The source line changed after it was translated",
            message: "{locale} translation is older than the line",
            messageInterface: "{locale} translation of {text} is older than the text",
            help:
                "A translation was written before its source text last changed. Each language is checked "
                + "against the lines and interface text it has translations for. Changing only styling, pauses "
                + "or inline events does not count; changing the words, or adding or removing an inserted "
                + "value, does.\n"
                + "\n"
                + "Players of that language still see the old translation, which may no longer match the "
                + "source.\n"
                + "\n"
                + "- In the language's translation table, the To review filter lists these. Edit the "
                + "translation where needed; an edit marks it current.\n"
                + "- If the translation is still right, Approve it in Review mode, which also marks it current.",
        },
        localizationMarkup: {
            title: "Translation drops styling",
            description: "The line has styling, pauses or inline events the translation does not carry",
            message: "{locale} translation does not carry all of this line's styling, pauses and inline events",
            help:
                "The line has styling, a pause or an inline event, and its translation in one language does "
                + "not carry all of them, or carries a tag the line does not have. Only translated story lines "
                + "are checked.\n"
                + "\n"
                + "Players of that language see those words unstyled, and a pause, expression change or sound "
                + "effect whose tag is missing does not happen.\n"
                + "\n"
                + "- Edit the translation in that language's translation table. Under Tags, a tag at full "
                + "strength is one the translation lacks: select the words and choose a styling tag, or place "
                + "the caret and choose a pause or event tag.\n"
                + "- If the translation leaves styling out on purpose, nothing needs to change; the rule can be "
                + "set to Off in Project ▸ Project ▸ Project check.",
        },
        localizationOrphan: {
            title: "Orphan translation",
            description: "A translation whose line no longer exists",
            message: "{translations} with no line",
            translationCount: {
                one: "{count} {locale} translation",
                other: "{count} {locale} translations",
            },
            help:
                "A language holds translations of story lines that are no longer in any story: lines whose "
                + "rows were deleted, cut and pasted elsewhere, or disabled, and lines a paste added before it "
                + "was undone. One finding per language gives the count. Interface text and translation keys "
                + "are not counted.\n"
                + "\n"
                + "Nothing in the game shows these translations, but they stay in the language and can be "
                + "carried into builds.\n"
                + "\n"
                + "- A row deleted by mistake: undo the deletion in the story editor, and its translation "
                + "applies again. A disabled row: right-click it and choose Enable.\n"
                + "- Otherwise the translations can stay. If the count is not wanted, set the rule to Off in "
                + "Project ▸ Project ▸ Project check.",
        },
        voiceMissing: {
            title: "Missing voice",
            description: "A line with no recording in a voiced language",
            message: "No {locale} recording",
            help:
                "A spoken line has no recording in one of the project's voice languages. Narration and "
                + "dialogue rows are checked, and choice options too while Voice choice options is on. Prompts, "
                + "blank lines and disabled rows are not.\n"
                + "\n"
                + "Players who choose that voice language hear no voice for the line.\n"
                + "\n"
                + "- Open the voice language in the Voice panel: the Missing filter lists these lines, and "
                + "Assign audio, or dropping audio on a row, links a recording.\n"
                + "- Import audio… in the language's More menu links many files at once by Recording filename "
                + "pattern; Export recording script lists the lines to record.\n"
                + "- If some lines are meant to stay silent, such as narration, set the rule to Off in Project "
                + "▸ Project ▸ Project check.",
        },
        voiceStale: {
            title: "Stale voice",
            description: "The line changed after it was recorded",
            message: "{locale} recording is older than the line",
            help:
                "A recording was linked to a line whose text has changed since. The text compared is what "
                + "that language's actor reads: the translation into that language if the project has one, "
                + "otherwise the source line.\n"
                + "\n"
                + "Players hear the old recording, which may not match the words on screen.\n"
                + "\n"
                + "- Record the line again and link the new file with Replace audio in the voice table, where "
                + "the Outdated filter lists these lines.\n"
                + "- Export pickup script (outdated only) in the language's More menu lists only these lines "
                + "for a recording session.\n"
                + "- If the recording still fits the new text, open Replace audio and confirm the same clip; "
                + "that marks it current.",
        },
        voiceOrphan: {
            title: "Orphan voice",
            description: "A recording whose line no longer exists",
            message: "{recordings} with no line",
            recordingCount: {
                one: "{count} {locale} recording",
                other: "{count} {locale} recordings",
            },
            help:
                "A voice language holds recordings linked to lines that are no longer in any story: lines "
                + "whose rows were deleted, cut and pasted elsewhere, or disabled, and lines a paste added "
                + "before it was undone. One finding per voice language gives the count.\n"
                + "\n"
                + "Nothing in the game plays these recordings, but they stay linked in the language, and their "
                + "audio can be carried into builds.\n"
                + "\n"
                + "- A row deleted by mistake: undo the deletion in the story editor, and its recording applies "
                + "again. A disabled row: right-click it and choose Enable.\n"
                + "- Otherwise the recordings can stay. If the count is not wanted, set the rule to Off in "
                + "Project ▸ Project ▸ Project check.",
        },
        brandBrokenLink: {
            title: "Broken color link",
            description: "A color pointing at a palette entry that resolves to nothing",
            // These three name their own site, unlike most rules: the finding is filed under the
            // project, so the locator column beside it prints nothing, and {where} is the only thing
            // that tells one of these findings from the next.
            message: "{where} uses a color the palette does not have",
            messageChain: "{where} uses {color}, which follows a color the palette does not have",
            messageCycle: "{where} uses {color}, whose links lead back to themselves",
            help:
                "A page, or a widget on a page or in a component, uses a project color that cannot be "
                + "resolved: the color is not in the palette, most often after being deleted on Project ▸ "
                + "Design, or it follows a chain of colors that ends at a missing one or leads back to itself. "
                + "The finding names the page or component, then the widget, then the field. Character colors "
                + "are not checked.\n"
                + "\n"
                + "That place is painted in its own default color instead. The game runs, with a color other "
                + "than the one chosen.\n"
                + "\n"
                + "- Open the page or component, select the widget, and choose a color for that field again.\n"
                + "- For a chain, open Project ▸ Design and point the color the widget uses at an existing "
                + "color, or give it a color of its own.",
        },
        typographyGlyphCoverage: {
            title: "Missing glyphs",
            description: "Text using characters no font of the project can draw",
            // The character itself, because nothing in the location can carry it and it is the only
            // thing that tells one of these findings from the next. Its count travels with it: one
            // finding per line would be thousands of them when the font is simply the wrong one.
            message: "No project font can draw “{character}” ({occurrences})",
            occurrenceCount: {
                one: "{count} time",
                other: "{count} times",
            },
            messageInLanguage: "No project font can draw “{character}” in {language} ({occurrences})",
            // The widget draws the character in the state it rests in; `{state}` is the name of the
            // state (appearance variant) whose font cannot.
            messageInState: "No project font can draw “{character}” in the “{state}” state ({occurrences})",
            messageInLanguageInState: "No project font can draw “{character}” in {language} in the “{state}” state ({occurrences})",
            messageMore: "{characters} no project font can draw",
            moreCharacterCount: {
                one: "{count} more character",
                other: "{count} more characters",
            },
            messageMoreInLanguage: "{characters} no project font can draw in {language}",
            // Not a coverage finding at all: the check could not be made. Said out loud because a
            // check that quietly did not run reads on screen as a check that passed.
            messageUnreadable: "{font} could not be read, so no character was checked",
            // A different fact from the one above: this file is fine and renders nothing anyway.
            messageUnloadable: "{font} is a .{format} font, which the game cannot draw with",
            help:
                "A character in the project's text that no font on its font list can draw. Story text, "
                + "character and scene names, translation keys and text on pages are checked in every language, "
                + "translated where a translation exists, and a widget is checked in the font of each of its "
                + "states. Spaces and emoji are skipped, a built-in font such as System UI counts as drawing "
                + "nothing, and a project with no fonts listed is not checked.\n"
                + "\n"
                + "Each character is reported once per language, at the first place it appears; past the number "
                + "set under this rule, 20 unless changed, the rest are counted in one finding. A font that "
                + "could not be read stops the check until it is fixed, and a .ttc, .otc, .eot or .svg font "
                + "draws nothing in the game.\n"
                + "\n"
                + "In the game a missing character is drawn in a font from the player's device, or as an empty "
                + "box where the device has none.\n"
                + "\n"
                + "- On Project ▸ Design ▸ Typography, add a font that has the character, or open a listed "
                + "font's languages with the button on its row and tick the language the finding names.\n"
                + "- For a finding that names a state, choose a font with the character for that state of the "
                + "widget.\n"
                + "- Replace a font that could not be read, or one in an unusable format, with a .ttf or .otf "
                + "file: right-click it in the Assets panel and choose Replace File….\n"
                + "- A character that should not be there is corrected in the text at the place the finding "
                + "names.",
        },
        typographyLocaleNoFont: {
            title: "Language with no font",
            description: "A language every font of the project is restricted away from",
            message: "Every project font is limited to languages other than {language}",
            help:
                "Every font on the project's font list is limited to other languages, so this language has no "
                + "project font. A project with no fonts listed is not checked.\n"
                + "\n"
                + "Text in this language is set in fonts from the player's device, which differ from one device "
                + "to the next, and missing characters in it are not reported except in widgets that choose "
                + "their own font.\n"
                + "\n"
                + "- On Project ▸ Design ▸ Typography, open a font's languages with the button on its row and "
                + "tick this language, or untick them all so the font serves every language.\n"
                + "- Or add a font for this language to the list.\n"
                + "- The button appears only while the project has two or more languages. With one, remove the "
                + "font from the list and add it again.",
        },
    },
    message: {
        ruleFailed: "{rule} could not run",
        storyLoadFailed: "{story} could not be opened",
        /**
         * Beside the line above and ahead of it, because it is the one reason a story will not open
         * that says nothing about the story. Without the two versions an author reads their own
         * file's name next to a failure and looks for the mistake in their script.
         */
        storyTooOld: "{story} is in story format v{version}, and this Studio opens v{minimum} and later",
        /**
         * The other end of the same ladder. Kept apart from the line above rather than worded to
         * cover both, because the two ask opposite things of the author: an old document is theirs
         * and this Studio has moved past it, a new one is theirs and this Studio has not caught up.
         */
        storyTooNew: "{story} was written by a newer NarraLeaf Studio (story format v{version}); this Studio reads up to v{supported}",
    },
    category: {
        assets: "Assets",
        portability: "Portability",
        network: "Network",
        story: "Story",
        blueprint: "Blueprint",
        // The author's word for what this category is about - pages and the widgets on them - not
        // the internal one ("surfaces"), which names nothing anybody sees in the interface.
        ui: "Pages",
        variables: "Variables",
        text: "Text",
        localization: "Localization",
        voice: "Voice",
        // Named after the panel the author fixes one of these in, not after the link protocol.
        brand: "Brand palette",
        // The word for the subject rather than for the panel, unlike `brand` above: the fonts
        // are edited on the same page as the palette, so naming this one after the page too
        // would give two categories one name.
        typography: "Typography",
    },
    severity: {
        error: "Error",
        warning: "Warning",
        info: "Info",
        off: "Off",
    },
    report: {
        title: "Problems",
        empty: "No problems found",
        running: "Checking…",
        // Each slot is one whole count with its noun, from `common.count.*`, so a count of one
        // reads in the singular.
        counts: "{errors}, {warnings}, {infos}",
        filtered: "{shown} of {total}",
        rerun: "Run again",
        filterAll: "All",
        groupByRule: "By rule",
        groupByLocation: "By location",
        collapse: "Collapse",
        expand: "Expand",
        collapseAll: "Collapse all",
        expandAll: "Expand all",
        // The last row of a rule that has far more findings than the report opens with. It names the
        // rule's whole count, which is the number already on the heading above it.
        showAll: "Show all {count}",
        // The gutter number of the row, spoken. Screen readers get "line 12"; the column itself is
        // bare digits, because that is what the scene editor's own gutter shows and the reader is
        // matching one against the other.
        lineAria: "Line {line}",
        findPlaceholder: "Find in problems",
        // What the list shows. The check itself always covers the whole project; these only narrow
        // what is listed, to the findings about what the open tabs show.
        scopeProject: "Whole project",
        scopeOpenEditors: "Open editors",
        scopeActiveEditor: "Current editor",
        scopeAria: "Show problems from",
        severityAria: "Severity",
        groupAria: "Group",
        emptyOpenEditors: "No problems in the open editors",
        emptyActiveEditor: "No problems in the current editor",
        emptyFiltered: "No problems at the selected severity",
        // The `?` on a finding: opens the topic about the rule that produced it.
        explain: "About this rule",
        settings: "Check settings",
        rerunHint: "Check the whole project again, re-reading the asset files on disk",
        // A finding whose place has gone since the check ran (deleted, or no longer that thing).
        jumpFailed: "This location can no longer be opened",
    },
    // The status bar cell's hover and spoken label. The cell itself shows the two numbers.
    statusBar: {
        counts: "Problems: {errors}, {warnings}, {infos}",
    },
    command: {
        runProject: "Check project",
        category: "Lint",
    },
    console: {
        // The console tab a sweep writes to, and what hovering it says. The same word as the
        // palette category above: it is one feature, and the tab sits among tabs named that way.
        channel: "Lint",
        channelDescription: "Project checks and the problems they find",
        started: "Check started",
        // `{errors}` and `{warnings}` are whole counts with their nouns, from `common.count.*`.
        finishedCounts: "{errors}, {warnings} in {duration}",
        // Site first, then what is wrong, then the rule that says so - a compiler's line, and the
        // order a reader scans in. No severity slot: the console prints the level in its own column
        // beside every line, and this used to repeat it inside the sentence.
        finding: "{location} {message} ({rule})",
        // The shape of the sweep, printed after the findings and beside the summary - the end of a
        // long log is the part an operator reads. A console cannot fold a rule away the way the
        // report tab can, and a sweep is routinely one rule repeated thousands of times, so without
        // these two lines the count of every other rule is unreadable in the stream.
        byRule: "Findings by rule",
        // The rule id, not its title: the id is the row in Project ▸ Project that retunes it, and
        // it is what the finding lines above print too. No severity in the sentence - the console
        // prints the level of every line in its own column, and this line carries the rule's.
        ruleCount: "{rule}: {count}",
    },
    build: {
        // Printed on the build channel when the sweep begins, because it is the longest thing
        // between the click and the first sign of a package, and the build channel is where an
        // author waiting for one is looking.
        started: "Checking the project…",
        blocked: {
            one: "Build stopped by {count} problem",
            other: "Build stopped by {count} problems",
        },
        // Spelled out panel → page → row, because the gate is on by default: an author who never
        // opened this panel has no reason to know the setting exists, and "in the lint settings"
        // would leave them looking for it.
        blockedHint: "Change this in Project ▸ Project ▸ Check before building",
        skipped: "Project check skipped",
        // The failure notice's button when the checks are what stopped the build.
        viewProblems: "View problems",
    },
    settings: {
        runOnBuild: "Check before building",
        runOnBuildHint: "Runs the project check as part of a production build",
        failBuildOn: "Stop the build on",
        failBuildOnError: "Errors",
        failBuildOnWarning: "Warnings and errors",
        optionMaxChars: "Maximum width",
        optionCountMode: "Counting",
        optionMaxMegabytes: "Largest file (MB)",
        optionMaxCharacters: "Characters listed",
        // Short because they have to be: these are the options of a select in a sidebar panel,
        // inset under its rule, and a sentence-long label is one that gets ellipsed to nothing.
        // The pair carries the meaning - the unit is columns, and the question is what a wide
        // character costs.
        countModeEastAsianWidth: "Wide = 2 columns",
        countModeCodePoints: "All = 1 column",
    },
} as const;
