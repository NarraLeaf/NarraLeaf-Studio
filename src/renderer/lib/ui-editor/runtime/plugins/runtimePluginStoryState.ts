/**
 * Story-variable access for the runtime plugin `state` capability.
 *
 * Plugins address variables by their authored NAME (`"gold"`), which is the only
 * handle a plugin author ever sees in Studio; ids and storage keys are accepted
 * too so a generated plugin can be explicit. Everything resolves against the
 * running story's declaration tables, so an unknown key reads null and writes
 * nothing rather than inventing a variable behind the author's back.
 *
 * Where the values actually live:
 *   - `scene`  → the active scene's Storable namespace (engine)
 *   - `saved`  → the story's saved Storable namespace (engine, travels in saves)
 *   - `persistent` → host persistence via the blueprint scope bridge (survives saves)
 *
 * Must stay under `@/lib/ui-editor/` so the standalone game runtime bundle can
 * include it (see project/build/build-runtime.js allowedPrefixes).
 */

import type { LiveGame } from "narraleaf-react";
import type { DevModeBundle } from "@shared/types/devMode";
import { savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story";
import type { StoryDocument } from "@shared/types/story";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { CompiledNlrStory } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { RuntimePluginStateChange, RuntimePluginStateScope } from "./runtimePluginApi";

/** One resolvable variable: what a key lookup lands on. */
export type RuntimePluginVariableDef = {
  id: string;
  name: string;
  storageKey: string;
  defaultValue: unknown;
};

type StorableNamespaceLike = {
  get: (key: string) => unknown;
  set: (key: string, value: never) => unknown;
  has: (key: string) => boolean;
};

/**
 * The declaration tables of the running story, indexed for lookup.
 *
 * Scene variables are per scene because a scene-local namespace only exists
 * while its scene is the active one — the table is rebuilt as scenes mount.
 */
export type RuntimePluginVariableTables = {
  /** Studio scene id → (alias → def). */
  scene: Record<string, Map<string, RuntimePluginVariableDef>>;
  saved: Map<string, RuntimePluginVariableDef>;
  persistent: Map<string, RuntimePluginVariableDef>;
};

function indexDefs(
  defs: Record<string, { id: string; name: string; storageKey: string; defaultValue?: unknown }>
): Map<string, RuntimePluginVariableDef> {
  const index = new Map<string, RuntimePluginVariableDef>();
  const entries = Object.values(defs).map((def) => ({
    id: def.id,
    name: def.name,
    storageKey: def.storageKey,
    defaultValue: def.defaultValue
  }));
  // Names first so they win every collision: a name is the author's handle,
  // the id/storageKey aliases are only an escape hatch for generated code.
  for (const def of entries) {
    if (def.name && !index.has(def.name)) {
      index.set(def.name, def);
    }
  }
  for (const def of entries) {
    if (!index.has(def.id)) {
      index.set(def.id, def);
    }
    if (!index.has(def.storageKey)) {
      index.set(def.storageKey, def);
    }
  }
  return index;
}

/**
 * Build the lookup tables for one running story. `persistent` and `saved` each merge the story's own
 * declaration rows (`/persis`, `/save`) with the project-level variable registry baked into the
 * bundle — the same merged view the editors show. A plugin asking for `"gold"` must find it whichever
 * surface the author declared it on.
 */
export function buildRuntimePluginVariableTables(
  bundle: DevModeBundle,
  storyId: string | null
): RuntimePluginVariableTables {
  const document: StoryDocument | undefined = storyId
    ? (bundle.storyLibrary?.documents[storyId] ??
      Object.values(bundle.storyLibrary?.documents ?? {}).find((entry) => entry.id === storyId))
    : undefined;
  const scene: Record<string, Map<string, RuntimePluginVariableDef>> = {};
  if (document) {
    for (const [sceneId, sceneDocument] of Object.entries(document.scenes)) {
      scene[sceneId] = indexDefs(sceneVariableDefs(sceneDocument));
    }
  }
  return {
    scene,
    saved: indexDefs({
      ...(document ? savedVariableDefs(document) : {}),
      ...bundle.ui.savedVariables
    }),
    persistent: indexDefs({
      ...(document ? storyPersistentDefs(document) : {}),
      ...bundle.ui.persistentVariables
    })
  };
}

export type RuntimePluginStorySession = {
  liveGame: LiveGame;
  compiled: CompiledNlrStory;
  tables: RuntimePluginVariableTables;
  /** Studio id of the scene currently mounted; scene variables resolve against it. */
  activeSceneId: string | null;
};

function namespaceOf(
  session: RuntimePluginStorySession,
  name: string
): StorableNamespaceLike | null {
  if (!name) {
    return null;
  }
  try {
    const storable = session.liveGame.getStorable();
    if (!storable.hasNamespace(name)) {
      return null;
    }
    return storable.getNamespace(name) as unknown as StorableNamespaceLike;
  } catch {
    return null;
  }
}

function sceneScopeIds(session: RuntimePluginStorySession): string[] {
  // The mounted scene first; the compiled entry scene is the fallback for
  // reads that happen before any scene has mounted (boot preload).
  const ids = [session.activeSceneId, session.compiled.sceneId];
  return ids.filter((id): id is string => Boolean(id));
}

function resolveDef(
  session: RuntimePluginStorySession,
  scope: RuntimePluginStateScope,
  key: string
): { def: RuntimePluginVariableDef; sceneId?: string } | null {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) {
    return null;
  }
  if (scope === "saved") {
    const def = session.tables.saved.get(trimmed);
    return def ? { def } : null;
  }
  if (scope === "persistent") {
    const def = session.tables.persistent.get(trimmed);
    return def ? { def } : null;
  }
  for (const sceneId of sceneScopeIds(session)) {
    const def = session.tables.scene[sceneId]?.get(trimmed);
    if (def) {
      return { def, sceneId };
    }
  }
  return null;
}

export function readRuntimePluginVariable(
  session: RuntimePluginStorySession | null,
  scope: RuntimePluginStateScope,
  key: string,
  persistence: ScopeStoreBridge | null
): unknown {
  if (scope === "persistent") {
    // Persistent values outlive any story session, so they resolve off the
    // scope bridge even before a game has been entered.
    const def = session?.tables.persistent.get(typeof key === "string" ? key.trim() : "");
    if (!def || !persistence) {
      return undefined;
    }
    const stored = persistence.persistenceGet(def.storageKey);
    return stored === undefined ? def.defaultValue : stored;
  }
  if (!session) {
    return undefined;
  }
  const resolved = resolveDef(session, scope, key);
  if (!resolved) {
    return undefined;
  }
  const namespaceName =
    scope === "saved"
      ? session.compiled.savedNamespaceName
      : (session.compiled.sceneLocalNamespaceNames[resolved.sceneId ?? ""] ?? "");
  const namespace = namespaceOf(session, namespaceName);
  if (!namespace) {
    return resolved.def.defaultValue;
  }
  return namespace.has(resolved.def.storageKey)
    ? namespace.get(resolved.def.storageKey)
    : resolved.def.defaultValue;
}

export function writeRuntimePluginVariable(
  session: RuntimePluginStorySession | null,
  scope: RuntimePluginStateScope,
  key: string,
  value: unknown,
  persistence: ScopeStoreBridge | null
): boolean {
  if (scope === "persistent") {
    const def = session?.tables.persistent.get(typeof key === "string" ? key.trim() : "");
    if (!def || !persistence) {
      return false;
    }
    persistence.persistenceSet(def.storageKey, value);
    return true;
  }
  if (!session) {
    return false;
  }
  const resolved = resolveDef(session, scope, key);
  if (!resolved) {
    return false;
  }
  const namespaceName =
    scope === "saved"
      ? session.compiled.savedNamespaceName
      : (session.compiled.sceneLocalNamespaceNames[resolved.sceneId ?? ""] ?? "");
  const namespace = namespaceOf(session, namespaceName);
  if (!namespace) {
    return false;
  }
  namespace.set(resolved.def.storageKey, value as never);
  return true;
}

/** Flat `alias → value` view of one scope, used to diff for change events. */
export type RuntimePluginStateSnapshot = Map<string, unknown>;

export function snapshotEngineScopes(session: RuntimePluginStorySession | null): {
  scene: RuntimePluginStateSnapshot;
  saved: RuntimePluginStateSnapshot;
} {
  const scene: RuntimePluginStateSnapshot = new Map();
  const saved: RuntimePluginStateSnapshot = new Map();
  if (!session) {
    return { scene, saved };
  }
  const sceneId = sceneScopeIds(session)[0];
  if (sceneId) {
    for (const def of new Set(session.tables.scene[sceneId]?.values() ?? [])) {
      scene.set(def.name || def.id, readRuntimePluginVariable(session, "scene", def.id, null));
    }
  }
  for (const def of new Set(session.tables.saved.values())) {
    saved.set(def.name || def.id, readRuntimePluginVariable(session, "saved", def.id, null));
  }
  return { scene, saved };
}

export function snapshotPersistentScope(
  session: RuntimePluginStorySession | null,
  persistence: ScopeStoreBridge | null
): RuntimePluginStateSnapshot {
  const snapshot: RuntimePluginStateSnapshot = new Map();
  if (!session || !persistence) {
    return snapshot;
  }
  for (const def of new Set(session.tables.persistent.values())) {
    const stored = persistence.persistenceGet(def.storageKey);
    snapshot.set(def.name || def.id, stored === undefined ? def.defaultValue : stored);
  }
  return snapshot;
}

/** Emit one change per key whose value differs between two snapshots of a scope. */
export function diffStateSnapshots(
  scope: RuntimePluginStateScope,
  previous: RuntimePluginStateSnapshot,
  next: RuntimePluginStateSnapshot
): RuntimePluginStateChange[] {
  const changes: RuntimePluginStateChange[] = [];
  for (const [key, value] of next) {
    const before = previous.get(key);
    if (!Object.is(before, value)) {
      changes.push({ scope, key, previous: before, next: value });
    }
  }
  for (const [key, value] of previous) {
    if (!next.has(key)) {
      changes.push({ scope, key, previous: value, next: undefined });
    }
  }
  return changes;
}
