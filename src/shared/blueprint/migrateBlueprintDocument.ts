/**
 * BlueprintDocument disk migration (shared between Workspace UIGraphService and main-process Dev Mode reads).
 */
import type {
  BindingSourceRef,
  BlueprintDocument,
  BlueprintField,
  BlueprintGraphIr,
  BlueprintGraphNode,
  BlueprintMemberIndex,
  BlueprintPersistentVariable,
  BlueprintPrivateOwnerRecord
} from "@shared/types/blueprint/document";
import {
  BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
  BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
  BLUEPRINT_NODE_TYPE_FLOW_DELAY,
  BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
  BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
  BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
  BLUEPRINT_NODE_TYPE_SOUND_PLAY
} from "@shared/types/blueprint/graph";
import {
  AUDIO_TRACK_ID_BGM,
  AUDIO_TRACK_ID_SOUND,
  AUDIO_TRACK_ID_VOICE
} from "@shared/types/audioTrack";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { seedRegistryEntriesFromBlueprintPersistent } from "@shared/variables/variableRegistryModel";
import {
  captureBlueprintDocumentEventOrder,
  captureBlueprintDocumentFunctionOrder
} from "./blueprintEventOrder";
import {
  ensureBlueprintEventGraphIrStructure,
  ensureBlueprintFunctionGraphIrStructure
} from "./normalizeBlueprintGraphIr";

/** Legacy v2 shape (ownerIndex only). */
export type BlueprintDocumentV2 = Omit<BlueprintDocument, "schemaVersion" | "ownerRecords"> & {
  schemaVersion: 2;
  ownerIndex: Record<string, string>;
};

/** v4 binding source before fields rename. */
type LegacyDeclarationBindingSource = {
  kind: "declaration";
  blueprintId: string;
  declarationId: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `Play Sound`'s param keys, spelled here rather than imported from the node module: this file is
 * shared and the node definitions are renderer-only (the main process reads blueprint documents
 * too). The renderer's `soundNodes.ts` exports the same two strings, and
 * `migrateBlueprintDocument.soundTrack.test.ts` asserts the two spellings agree.
 */
const LEGACY_SOUND_CHANNEL_PARAM = "soundChannel";
const SOUND_TRACK_PARAM = "audioTrackId";

/**
 * One seeded bus per legacy channel. Identity since the seeded tracks took the engine's channel
 * names, but kept as a map because the *meaning* is "the bus a legacy `soundChannel` param lands
 * on", which the seeded ids happen to spell the same way rather than by definition.
 */
const LEGACY_CHANNEL_TO_TRACK_ID: Record<string, string> = {
  bgm: AUDIO_TRACK_ID_BGM,
  sound: AUDIO_TRACK_ID_SOUND,
  voice: AUDIO_TRACK_ID_VOICE
};

/**
 * Merge legacy `members.declarations` into `members.fields`, rewrite binding sources, normalize member shape.
 * Idempotent for documents already on v5.
 */
export function migrateLegacyDeclarationsToFields(doc: BlueprintDocument): BlueprintDocument {
  const blueprints = { ...doc.blueprints };
  for (const bp of Object.values(blueprints)) {
    if (!bp.members) {
      continue;
    }
    const mem = bp.members as BlueprintMemberIndex & {
      declarations?: Record<string, BlueprintField>;
    };
    const legacyDecls = mem.declarations;
    const existingFields = mem.fields ?? {};
    if (legacyDecls && Object.keys(legacyDecls).length > 0) {
      bp.members = {
        variables: mem.variables ?? {},
        fields: { ...existingFields, ...legacyDecls },
        functions: mem.functions ?? {}
      };
    } else if (!mem.fields) {
      bp.members = {
        variables: mem.variables ?? {},
        fields: existingFields,
        functions: mem.functions ?? {}
      };
    }
    delete (bp.members as Record<string, unknown>).declarations;

    for (const bind of Object.values(bp.bindings ?? {})) {
      const src = bind.source as BindingSourceRef | LegacyDeclarationBindingSource;
      if (src.kind === "declaration") {
        bind.source = {
          kind: "field",
          blueprintId: src.blueprintId,
          fieldId: src.declarationId
        };
      }
    }
  }
  return { ...doc, blueprints };
}

/**
 * v9 (M-VAR): `persistentVariables` left the blueprint document for the project-level variable
 * registry. Strip the field, and remap every `persistentVariableId` node param whose old key differed
 * from its storage key (in practice they match - the factory set `storageKey: id` - so the remap is
 * usually empty). The registry is SEEDED elsewhere (UIGraphService / bundleAssembler read the raw
 * pre-migration field); this function only cleans the document so it stops carrying the variables.
 */
function stripPersistentVariables(doc: BlueprintDocument): BlueprintDocument {
  const raw = doc as BlueprintDocument & {
    persistentVariables?: Record<string, BlueprintPersistentVariable>;
  };
  const persistentVariables = isRecord(raw.persistentVariables)
    ? raw.persistentVariables
    : undefined;
  const { entries: _entries, idRemap } =
    seedRegistryEntriesFromBlueprintPersistent(persistentVariables);
  void _entries;
  if (Object.keys(idRemap).length > 0) {
    remapPersistentVariableIdParams(doc, idRemap);
  }
  const { persistentVariables: _drop, ...rest } = raw;
  void _drop;
  return rest;
}

function remapPersistentVariableIdParams(
  doc: BlueprintDocument,
  idRemap: Record<string, string>
): void {
  for (const bp of Object.values(doc.blueprints)) {
    if (bp.program.kind !== "graph") {
      continue;
    }
    const graphs = bp.program.graphs;
    const allGraphs = [
      ...Object.values(graphs.events ?? {}),
      ...Object.values(graphs.functions ?? {}),
      ...Object.values(graphs.macros ?? {})
    ];
    for (const g of allGraphs) {
      for (const node of Object.values(g.graph?.nodes ?? {})) {
        if (
          node.type !== BLUEPRINT_NODE_TYPE_PERSISTENT_GET &&
          node.type !== BLUEPRINT_NODE_TYPE_PERSISTENT_SET
        ) {
          continue;
        }
        const current = node.params?.persistentVariableId;
        if (typeof current === "string" && idRemap[current]) {
          node.params!.persistentVariableId = idRemap[current];
        }
      }
    }
  }
}

function millisecondsToSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value / 1000 : undefined;
}

function migrateTimingParamsForNode(node: BlueprintGraphNode): void {
  const params = node.params;
  if (!params) {
    return;
  }
  if (node.type === BLUEPRINT_NODE_TYPE_FLOW_DELAY) {
    const duration = millisecondsToSeconds(params.duration);
    if (duration !== undefined) {
      params.duration = duration;
    }
    return;
  }
  if (
    node.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY ||
    node.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY
  ) {
    const duration = millisecondsToSeconds(params.durationMs);
    if (duration !== undefined) {
      params.duration = duration;
    }
    const delay = millisecondsToSeconds(params.delayMs);
    if (delay !== undefined) {
      params.delay = delay;
    }
    delete params.durationMs;
    delete params.delayMs;
  }
}

function migrateTimingParamsForGraph(graph: BlueprintGraphIr | undefined): void {
  if (!graph?.nodes) {
    return;
  }
  for (const node of Object.values(graph.nodes)) {
    migrateTimingParamsForNode(node);
  }
}

function migrateBlueprintTimingUnitsToSeconds(doc: BlueprintDocument): BlueprintDocument {
  for (const bp of Object.values(doc.blueprints)) {
    if (bp.program.kind !== "graph") {
      continue;
    }
    const graphs = bp.program.graphs;
    for (const eventGraph of Object.values(graphs.events ?? {})) {
      migrateTimingParamsForGraph(eventGraph.graph);
    }
    for (const functionGraph of Object.values(graphs.functions ?? {})) {
      migrateTimingParamsForGraph(functionGraph.graph);
    }
    for (const macroGraph of Object.values(graphs.macros ?? {})) {
      migrateTimingParamsForGraph(macroGraph.graph);
    }
  }
  return doc;
}

function migrateSentenceCpsPinsForNode(node: BlueprintGraphNode): void {
  if (node.type !== BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED) {
    return;
  }
  if (node.params && Object.prototype.hasOwnProperty.call(node.params, "speed")) {
    if (!Object.prototype.hasOwnProperty.call(node.params, "cps")) {
      node.params.cps = node.params.speed;
    }
    delete node.params.speed;
  }
  const ports = node.ports;
  const legacySpeedPort = ports?.speed;
  if (ports && legacySpeedPort) {
    if (!ports.cps) {
      ports.cps = {
        ...legacySpeedPort,
        label: legacySpeedPort.label === "Speed" ? "CPS" : legacySpeedPort.label
      };
    }
    delete ports.speed;
  }
}

function migrateSentenceCpsPinsForGraph(graph: BlueprintGraphIr | undefined): void {
  if (!graph?.nodes) {
    return;
  }
  const sentenceSpeedNodeIds = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.type === BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED) {
      sentenceSpeedNodeIds.add(node.id);
      migrateSentenceCpsPinsForNode(node);
    }
  }
  for (const edge of graph.edges ?? []) {
    if (sentenceSpeedNodeIds.has(edge.to.nodeId) && edge.to.port === "speed") {
      edge.to.port = "cps";
    }
  }
}

function migrateBlueprintSentenceSpeedToCps(doc: BlueprintDocument): BlueprintDocument {
  for (const bp of Object.values(doc.blueprints)) {
    if (bp.program.kind !== "graph") {
      continue;
    }
    const graphs = bp.program.graphs;
    for (const eventGraph of Object.values(graphs.events ?? {})) {
      migrateSentenceCpsPinsForGraph(eventGraph.graph);
    }
    for (const functionGraph of Object.values(graphs.functions ?? {})) {
      migrateSentenceCpsPinsForGraph(functionGraph.graph);
    }
    for (const macroGraph of Object.values(graphs.macros ?? {})) {
      migrateSentenceCpsPinsForGraph(macroGraph.graph);
    }
  }
  return doc;
}

/**
 * `Play Sound`'s old three-value `soundChannel` select becomes an audio track reference.
 *
 * The channel vocabulary and the track vocabulary described the same thing twice, so the select is
 * gone; what a graph stored still has to keep working, and each channel has exactly one built-in
 * track (`bgm`→Music, `sound`→SFX, `voice`→Voice) whose seeded defaults reproduce the old
 * behaviour. Applied on every read, including documents already on the current schema version:
 * this is a param rename inside a node, not a document shape change, so there is no version to
 * gate it on and a graph saved by an older Studio must migrate whenever it is opened.
 *
 * Idempotent - a node that already carries `audioTrackId` is left alone, so re-reading a migrated
 * document (or one where the author has since picked a custom track) cannot clobber the choice.
 */
function migrateSoundChannelParamsForNode(node: BlueprintGraphNode): void {
  if (node.type !== BLUEPRINT_NODE_TYPE_SOUND_PLAY || !node.params) {
    return;
  }
  const params = node.params;
  if (!Object.prototype.hasOwnProperty.call(params, LEGACY_SOUND_CHANNEL_PARAM)) {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(params, SOUND_TRACK_PARAM)) {
    const channel = params[LEGACY_SOUND_CHANNEL_PARAM];
    params[SOUND_TRACK_PARAM] =
      LEGACY_CHANNEL_TO_TRACK_ID[String(channel)] ??
      // An unreadable channel meant "sound" to `normalizeBlueprintSoundChannel`, so it means
      // the SFX track here. Dropping the param instead would silently re-point the node.
      LEGACY_CHANNEL_TO_TRACK_ID.sound;
  }
  delete params[LEGACY_SOUND_CHANNEL_PARAM];
}

function migrateSoundChannelParamsForGraph(graph: BlueprintGraphIr | undefined): void {
  if (!graph?.nodes) {
    return;
  }
  for (const node of Object.values(graph.nodes)) {
    migrateSoundChannelParamsForNode(node);
  }
}

function migrateBlueprintSoundChannelToTrack(doc: BlueprintDocument): BlueprintDocument {
  for (const bp of Object.values(doc.blueprints)) {
    if (bp.program.kind !== "graph") {
      continue;
    }
    const graphs = bp.program.graphs;
    for (const eventGraph of Object.values(graphs.events ?? {})) {
      migrateSoundChannelParamsForGraph(eventGraph.graph);
    }
    for (const functionGraph of Object.values(graphs.functions ?? {})) {
      migrateSoundChannelParamsForGraph(functionGraph.graph);
    }
    for (const macroGraph of Object.values(graphs.macros ?? {})) {
      migrateSoundChannelParamsForGraph(macroGraph.graph);
    }
  }
  return doc;
}

function finalizeLegacyBlueprintDocument(doc: BlueprintDocument): BlueprintDocument {
  return migrateBlueprintSoundChannelToTrack(
    migrateBlueprintSentenceSpeedToCps(
      migrateBlueprintTimingUnitsToSeconds(
        stripPersistentVariables(migrateLegacyDeclarationsToFields(doc))
      )
    )
  );
}

/**
 * If document is v2/v3/v4, upgrade to latest. Idempotent for current schema.
 */
export function migrateBlueprintDocumentToLatest(raw: unknown): BlueprintDocument {
  if (!isRecord(raw)) {
    throw new Error("BlueprintDocument: expected object");
  }
  // v10 (H2a). Both before any other pass, because every one of them rebuilds objects
  // (`{...doc, blueprints}`, `{...graphs, events, functions}`) and the graph-slot order
  // exists only as the key order of `events` / `functions` until these two lines have run.
  // Nothing downstream can recover it once a rebuild has reinserted the keys, and the
  // result would look like a perfectly valid order rather than like data loss.
  captureBlueprintDocumentEventOrder(raw);
  captureBlueprintDocumentFunctionOrder(raw);
  const sv = raw.schemaVersion;
  if (sv === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
    return migrateBlueprintSoundChannelToTrack(
      migrateBlueprintSentenceSpeedToCps(
        stripPersistentVariables(migrateLegacyDeclarationsToFields(raw as BlueprintDocument))
      )
    );
  }
  if ((sv === 5 || sv === 6 || sv === 7 || sv === 8 || sv === 9) && isRecord(raw.blueprints)) {
    const migrated = finalizeLegacyBlueprintDocument(raw as BlueprintDocument);
    return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
  }
  if (sv === 4 && isRecord(raw.blueprints)) {
    const migrated = finalizeLegacyBlueprintDocument(raw as BlueprintDocument);
    return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
  }
  if (sv === 3 && isRecord(raw.blueprints)) {
    let seq = 0;
    const generateId = () => `nl_mig_${++seq}`;
    const withBodies = upgradeBlueprintGraphBodiesToV4(raw as BlueprintDocument, generateId);
    const migrated = finalizeLegacyBlueprintDocument(withBodies);
    return { ...migrated, schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
  }
  if (sv === 2 && isRecord(raw.ownerIndex) && isRecord(raw.blueprints)) {
    const ownerIndex = raw.ownerIndex as Record<string, string>;
    const ownerRecords: Record<string, BlueprintPrivateOwnerRecord> = {};
    for (const [key, blueprintId] of Object.entries(ownerIndex)) {
      if (typeof blueprintId !== "string") {
        continue;
      }
      ownerRecords[key] = {
        activeBlueprintId: blueprintId,
        privateBlueprintIds: [blueprintId]
      };
    }
    const { ownerIndex: _drop, ...rest } = raw as BlueprintDocumentV2 & Record<string, unknown>;
    void _drop;
    let seq = 0;
    const generateId = () => `nl_mig_${++seq}`;
    const interim = {
      ...rest,
      ownerRecords
    } as unknown as BlueprintDocument;
    const upgraded = upgradeBlueprintGraphBodiesToV4(interim, generateId);
    const migrated = finalizeLegacyBlueprintDocument(upgraded);
    return {
      ...migrated,
      schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION
    };
  }
  throw new Error(`Unsupported BlueprintDocument schemaVersion: ${String(sv)}`);
}

/** Ensures graph IR shape: function graphs get a Function entry; event layers normalize meta (Event nodes are user-placed). */
export function upgradeBlueprintGraphBodiesToV4(
  doc: BlueprintDocument,
  generateId: () => string
): BlueprintDocument {
  const blueprints = { ...doc.blueprints };
  for (const bp of Object.values(blueprints)) {
    if (bp.program.kind !== "graph") {
      continue;
    }
    const graphs = bp.program.graphs;
    const events = { ...(graphs.events ?? {}) };
    for (const [eid, eg] of Object.entries(events)) {
      if (eg.graph) {
        events[eid] = {
          ...eg,
          graph: ensureBlueprintEventGraphIrStructure(eg.graph, generateId)
        };
      }
    }
    const functions = { ...(graphs.functions ?? {}) };
    for (const [fid, fg] of Object.entries(functions)) {
      if (fg.graph) {
        functions[fid] = {
          ...fg,
          graph: ensureBlueprintFunctionGraphIrStructure(fg.graph, generateId)
        };
      }
    }
    bp.program.graphs = { ...graphs, events, functions };
  }
  return { ...doc, blueprints };
}
