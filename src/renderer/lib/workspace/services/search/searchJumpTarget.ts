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
    | { kind: "uiSurface"; surfaceId: string }
    | { kind: "asset"; assetId: string; assetType: string }
    | {
          kind: "blueprint";
          blueprintId: string;
          /** Owner slot key (e.g. `surfaceMain:<id>`); parsed into an editor open target at jump time. */
          ownerKey: string;
          focusEventId?: string;
          focusFunctionId?: string;
          focusNodeId?: string;
      }
    | { kind: "localizationKey"; keyName: string };
