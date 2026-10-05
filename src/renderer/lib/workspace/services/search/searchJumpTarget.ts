/**
 * Where a search result goes when it is activated - the workspace's whole deep-link vocabulary.
 *
 * It lives in a module of its own rather than inside the index model because it is **public plugin
 * API**: `@/plugin` re-exports it, and lint findings, test findings and asset references all carry
 * one so their reports get click-to-jump for free. Those consumers have nothing to do with searching,
 * and the index model has to stay free to change without moving their imports. `searchIndexModel`
 * re-exports it, so every existing import path keeps working.
 *
 * `searchJump.ts` dispatches on `kind` exhaustively - a new variant is a compile error there, which is
 * the intended way to find out that a new navigable thing needs an answer to "and what opens it?".
 */
export type SearchJumpTarget =
    | { kind: "storyBlock"; storyId: string; sceneId: string; blockId: string; storyName: string; sceneName: string }
    | { kind: "storyScene"; storyId: string; sceneId: string; storyName: string; sceneName: string }
    /** A whole story: its flow map is the view of a story rather than of one scene. */
    | { kind: "storyFlow"; storyId: string; storyName: string }
    | { kind: "character"; characterId: string }
    /**
     * A page or a stage layer. With `elementId`, the widget on it to select once its editor opens - an
     * optional field rather than a variant of its own, so every consumer that opens the page keeps
     * opening it and only the ones that can say which widget say so.
     */
    | { kind: "uiSurface"; surfaceId: string; elementId?: string }
    /**
     * A component definition: its own editor tab, the one the component library opens. With
     * `elementId`, the widget inside the definition to select, as for a page.
     */
    | { kind: "uiComponent"; componentId: string; elementId?: string }
    | { kind: "asset"; assetId: string; assetType: string }
    /**
     * An asset set - a thing a reference can point at that is not a file.
     *
     * Its own variant rather than an `asset` with a flag: the two are opened by different means (a
     * file has a preview editor, a set is a row in the assets panel with an inspector), and folding
     * them together would make every consumer of this vocabulary ask "which sort is it" before it
     * could act. A story row naming a set used to produce the `asset` variant, which resolved to
     * nothing in the library and made the jump a click that did nothing at all.
     */
    | { kind: "assetSet"; assetSetId: string }
    | {
          kind: "blueprint";
          blueprintId: string;
          /** Owner slot key (e.g. `surfaceMain:<id>`); parsed into an editor open target at jump time. */
          ownerKey: string;
          focusEventId?: string;
          focusFunctionId?: string;
          focusNodeId?: string;
      }
    /**
     * A named string: its row in a translation table, which is the one place its words are edited.
     * Opens the table of the project's first translated language; a project with none has no table,
     * and the jump shows the Localization panel instead, where a language is added.
     */
    | { kind: "localizationKey"; keyName: string }
    /**
     * A project-level story variable: its row in the Variables panel, selected and scrolled into view.
     * `variableId` is the registry entry's id, or the declaration row's for one a story declares.
     */
    | { kind: "storyVariable"; scope: "saved" | "persistent"; variableId: string }
    /**
     * A translation table - one language's - and, with `unitId`, the row of one translation unit in
     * it, scrolled into view and marked.
     *
     * The table lists one source at a time, so a row is found under the source it belongs to:
     * `storyId` for a story's lines and scene names, absent for the interface's words, the named keys
     * and the plugins' words. A character's name heads every story's rows and needs neither.
     */
    | { kind: "translation"; locale: string; unitId?: string; storyId?: string }
    /**
     * A voice table - one voiced language's - and, with `unitId` (a line's text id), that line's row,
     * where its take is linked. `storyId` names the story the line is in; without it the table looks
     * the line up itself.
     */
    | { kind: "voiceLine"; locale: string; unitId?: string; storyId?: string }
    /** A story motion, open in its own editor. */
    | { kind: "storyMotion"; animationId: string }
    /**
     * A page of Project settings - the panel's sub-pages - and, with `part`, the part of it to scroll
     * into view: `fonts` is the project's font stack on the Design page.
     */
    | { kind: "projectPage"; page: "app" | "game" | "design" | "project" | "runtimes" | "settings"; part?: "fonts" }
    /**
     * A story's own row in the Story panel's list, selected and scrolled into view - the place a story
     * is renamed or deleted, and the one way into a story whose document cannot be opened.
     */
    | { kind: "storyEntry"; storyId: string; storyName: string };
