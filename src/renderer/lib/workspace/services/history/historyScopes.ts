import type { HistoryScopeId } from "./historyModel";

/**
 * Every undo stack in the workspace, named in one place.
 *
 * A scope id is a Map key, so two spellings of the same stack are two stacks, and the second one is
 * always empty - the failure mode is "Ctrl+Z did nothing", which reads as a bug in the editor
 * rather than a typo in a string. Hence constructors instead of template literals at call sites.
 *
 * The prefix is what {@link isHistoryScopeOf} matches on, so a whole family can be cleared at once
 * (every scene of a story that just got reloaded, say) without knowing the ids.
 */
export const HistoryScopeKind = {
  /** One scene of one story. Survives the tab closing; see `HistoryService.registerScope`. */
  StoryScene: "story-scene",
  /** One story motion asset's timeline. */
  StoryMotion: "story-motion",
  /** One audio asset's in/loop/out markers. */
  AudioLoop: "audio-loop",
  /** One UI editor surface, with the private blueprints that belong to it. */
  UISurface: "ui-surface",
  /** One blueprint graph. */
  Blueprint: "blueprint",
  /**
   * Everything that is not scoped to an editor: creating and deleting characters, assets,
   * scenes, chapters, stories. One stack per project window, because these edits are not "in" a
   * document the author has open - and a stack that only exists while some tab is mounted cannot
   * hold them.
   */
  Project: "project"
} as const;

export type HistoryScopeKind = (typeof HistoryScopeKind)[keyof typeof HistoryScopeKind];

function scope(kind: HistoryScopeKind, ...parts: string[]): HistoryScopeId {
  return [kind, ...parts].join(":");
}

export function storySceneHistoryScope(storyId: string, sceneId: string): HistoryScopeId {
  return scope(HistoryScopeKind.StoryScene, storyId, sceneId);
}

export function storyMotionHistoryScope(animationId: string): HistoryScopeId {
  return scope(HistoryScopeKind.StoryMotion, animationId);
}

export function audioLoopHistoryScope(assetId: string): HistoryScopeId {
  return scope(HistoryScopeKind.AudioLoop, assetId);
}

export function uiSurfaceHistoryScope(surfaceId: string): HistoryScopeId {
  return scope(HistoryScopeKind.UISurface, surfaceId);
}

export function blueprintHistoryScope(blueprintId: string): HistoryScopeId {
  return scope(HistoryScopeKind.Blueprint, blueprintId);
}

/** The single project-wide stack. Takes no arguments - one window, one project, one stack. */
export function projectHistoryScope(): HistoryScopeId {
  return HistoryScopeKind.Project;
}

export function isHistoryScopeOf(scopeId: HistoryScopeId, kind: HistoryScopeKind): boolean {
  return scopeId === kind || scopeId.startsWith(`${kind}:`);
}

/** The id parts after the kind, in the order they were passed to the constructor. */
export function historyScopeParts(scopeId: HistoryScopeId): string[] {
  return scopeId.split(":").slice(1);
}
