/**
 * `documents` - what a reader says about a project file it will not read.
 *
 * One namespace rather than a line per surface: the same refusal is shown by the Dev Mode console,
 * the Dev Mode failure screen and the build report, and a sentence that differed between them would
 * be three answers to one question. The nouns below are the closed list of document kinds
 * (`ProjectDocumentKind`), held to it by a test.
 */
export const documents = {
    tooNew: {
        // `{subject}` is a story's own name or the file's project-relative path; `{kind}` is one of
        // the nouns below. Both version numbers, because "cannot be read" cannot tell an author a
        // damaged file from a project a newer Studio has already opened.
        message: "{subject} was written by a newer NarraLeaf Studio ({kind} format v{version}); this build reads up to v{supported}",
        kind: {
            story: "story",
            storyIndex: "story library",
            storyAnimation: "animation",
            uiDocument: "interface",
            uiGraphs: "interface blueprint",
            blueprints: "blueprint",
            variables: "variable",
            saveSchema: "save schema",
            localization: "translation",
            localizationKeys: "translation key",
            voice: "voice",
            brand: "design",
            appTags: "variant",
            dlc: "DLC",
            assetSets: "asset set",
            audioTracks: "audio track",
            characters: "character",
        },
    },
} as const;
