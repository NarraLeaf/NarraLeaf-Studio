/**
 * Merge static node pin definitions with instance params for variadic input nodes.
 * Comments in English per project convention.
 */

import type {
  BlueprintNodeDef,
  BlueprintNodeDynamicInputPinsConfig,
  BlueprintNodeEditorCatalogEntry,
  BlueprintNodePinDef
} from "./types";
import {
  BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN,
  BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES
} from "./types";
import {
  BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
  BLUEPRINT_NODE_TYPE_ELEMENT_REF,
  BLUEPRINT_NODE_TYPE_FN_CALL,
  BLUEPRINT_NODE_TYPE_LOCAL_GET,
  BLUEPRINT_NODE_TYPE_LOCAL_SET,
  BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
  BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
  readBlueprintFnSignatureSnapshot
} from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";
import { getActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";

/**
 * What a save-schema pin id starts with.
 *
 * Prefixed rather than the bare field id so a uuid can never collide with a node's own pin names
 * (`id`, `metadata`, `screenshot`), and so a reader of a stored graph can tell at a glance which
 * edges belong to the project's schema.
 */
const SAVE_SCHEMA_PIN_PREFIX = "field:";

export type EffectiveCatalogPin = BlueprintNodeEditorCatalogEntry["pins"][number];

/** Read ordered dynamic input pin ids from node.params. */
export function readDynamicInputPinIds(
  params: Record<string, unknown> | undefined,
  storageKey: string
): string[] {
  if (!params) {
    return [];
  }
  const raw = params[storageKey];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/** Read dynamic input pin labels from node.params. */
export function readDynamicInputPinLabels(
  params: Record<string, unknown> | undefined,
  storageKey: string | undefined
): Record<string, string> {
  if (!params || !storageKey) {
    return {};
  }
  const raw = params[storageKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim().length > 0) {
      out[key] = value.trim();
    }
  }
  return out;
}

/** Read per-pin valueType overrides from node.params. */
export function readDynamicInputPinValueTypes(
  params: Record<string, unknown> | undefined,
  storageKey: string | undefined
): Record<string, string> {
  if (!params || !storageKey) {
    return {};
  }
  const raw = params[storageKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim().length > 0) {
      out[key] = value.trim();
    }
  }
  return out;
}

function dynamicIdsForBase(cfg: BlueprintNodeDynamicInputPinsConfig, baseId: string): string[] {
  const templates = cfg.generatedPinTemplates;
  if (!templates?.length) {
    return [baseId];
  }
  return templates.map((template) => `${baseId}_${template.idSuffix}`);
}

function readDynamicGroupBaseId(
  cfg: BlueprintNodeDynamicInputPinsConfig,
  pinId: string
): string | undefined {
  for (const template of cfg.generatedPinTemplates ?? []) {
    const suffix = `_${template.idSuffix}`;
    if (pinId.endsWith(suffix)) {
      return pinId.slice(0, -suffix.length);
    }
  }
  return undefined;
}

function readDynamicPinTemplate(
  cfg: BlueprintNodeDynamicInputPinsConfig,
  pinId: string
): NonNullable<BlueprintNodeDynamicInputPinsConfig["generatedPinTemplates"]>[number] | undefined {
  for (const template of cfg.generatedPinTemplates ?? []) {
    if (pinId.endsWith(`_${template.idSuffix}`)) {
      return template;
    }
  }
  return undefined;
}

function readParamString(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isVariableValuePin(def: BlueprintNodeDef, pin: BlueprintNodePinDef): boolean {
  if (pin.id !== "value" || pin.semantic !== "data") {
    return false;
  }
  return (
    def.type === BLUEPRINT_NODE_TYPE_LOCAL_GET ||
    def.type === BLUEPRINT_NODE_TYPE_LOCAL_SET ||
    def.type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET ||
    def.type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET
  );
}

function resolveStaticPinValueType(
  def: BlueprintNodeDef,
  pin: BlueprintNodePinDef,
  params: Record<string, unknown> | undefined
): string | undefined {
  if (isVariableValuePin(def, pin)) {
    return readParamString(params, BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE) ?? pin.valueType;
  }
  return pin.valueType;
}

/** Next unused id set, avoiding static pins and existing dynamic ids. */
export function generateNextDynamicInputPinIds(
  def: BlueprintNodeDef,
  params: Record<string, unknown>
): string[] {
  const cfg = def.dynamicInputPins;
  if (!cfg) {
    throw new Error("[effectivePins] Node has no dynamicInputPins config");
  }
  const staticIds = new Set(def.pins.map((p) => p.id));
  const dynamicIds = new Set(readDynamicInputPinIds(params, cfg.storageKey));
  let n = 1;
  for (;;) {
    const baseId = `${cfg.generatedIdPrefix}_${n}`;
    const ids = dynamicIdsForBase(cfg, baseId);
    if (!dynamicIds.has(baseId) && ids.every((id) => !staticIds.has(id) && !dynamicIds.has(id))) {
      return ids;
    }
    n += 1;
  }
}

/** Next unused id `${prefix}_${n}` avoiding static pins and existing dynamic ids. */
export function generateNextDynamicInputPinId(
  def: BlueprintNodeDef,
  params: Record<string, unknown>
): string {
  return generateNextDynamicInputPinIds(def, params)[0];
}

/** Dynamic ids removed together when a generated grouped pin is deleted. */
export function getDynamicInputPinRemovalIds(
  def: BlueprintNodeDef,
  params: Record<string, unknown> | undefined,
  pinId: string
): string[] {
  const cfg = def.dynamicInputPins;
  if (!cfg) {
    return [pinId];
  }
  const dynamicIdSet = new Set(readDynamicInputPinIds(params, cfg.storageKey));
  const baseId = readDynamicGroupBaseId(cfg, pinId);
  if (!baseId) {
    return [pinId];
  }
  const ids = dynamicIdsForBase(cfg, baseId).filter((id) => dynamicIdSet.has(id));
  return ids.length > 0 ? ids : [pinId];
}

/** The pin id one declared save field is addressed by. Stable across renames - the id never moves. */
export function saveSchemaPinId(fieldId: string): string {
  return `${SAVE_SCHEMA_PIN_PREFIX}${fieldId}`;
}

/** The field id behind a save-schema pin, or null when the pin is not one. */
export function saveSchemaFieldIdFromPin(pinId: string): string | null {
  return pinId.startsWith(SAVE_SCHEMA_PIN_PREFIX)
    ? pinId.slice(SAVE_SCHEMA_PIN_PREFIX.length)
    : null;
}

/**
 * Append the project's declared save fields to a node's own pins.
 *
 * Read from the live schema rather than from `params`, which is what makes the write node and the
 * read node grow the same pins: they are two views of one project document, not two node-local
 * lists that have to be kept in step by hand.
 *
 * The node's static pins stay exactly where they are, including the raw `metadata` pin. That pin is
 * the escape hatch and is never taken away - an existing graph that wires it keeps working the
 * moment a field is declared, and a key that belongs to nobody (a plugin's, a legacy one) still has
 * somewhere to ride.
 */
function withSaveSchemaPins(
  def: BlueprintNodeDef,
  basePins: BlueprintNodePinDef[]
): BlueprintNodePinDef[] {
  const cfg = def.saveSchemaPins;
  if (!cfg) {
    return basePins;
  }
  const fields = getActiveSaveSchemaFields();
  if (fields.length === 0) {
    return basePins;
  }
  const schemaPins: BlueprintNodePinDef[] = fields.map((field) => ({
    id: saveSchemaPinId(field.id),
    kind: cfg.kind,
    semantic: "data",
    valueType: field.valueType,
    label: field.name,
    // Inline literals on the write side only: an output has nothing to type into. A field the
    // author can fill on the card is the difference between "declare a chapter name" and "wire
    // a String node to every one of six slots".
    allowInlineLiteral:
      cfg.kind === "input" &&
      (BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES as readonly string[]).includes(field.valueType)
  }));
  // Appended after the node's own pins rather than interleaved: the static pins are the node's
  // identity (which slot, capture or not) and the declared fields are the project's, so a reader
  // scanning a card sees one group and then the other.
  return [...basePins, ...schemaPins];
}

/**
 * Effective pin defs for execution / validation: exec inputs, fixed data inputs, dynamic data inputs, outputs.
 */
export function resolveEffectiveBlueprintNodePins(
  def: BlueprintNodeDef,
  params?: Record<string, unknown>
): BlueprintNodePinDef[] {
  const magicInputPinId = def.magicElementTarget?.inputPinId;
  const showMagicInputPin =
    Boolean(params?.[BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN]) ||
    (Boolean(def.magicElementTarget) && !def.scope);
  const basePins =
    magicInputPinId && !showMagicInputPin
      ? def.pins.filter((pin) => pin.id !== magicInputPinId)
      : def.pins;
  const typedBasePins = basePins.map((pin) => {
    const valueType = resolveStaticPinValueType(def, pin, params);
    return valueType === pin.valueType ? pin : { ...pin, valueType };
  });
  if (def.type === BLUEPRINT_NODE_TYPE_ELEMENT_REF) {
    const elementType = typeof params?.elementType === "string" ? params.elementType : undefined;
    return typedBasePins.map((pin) =>
      pin.kind === "output" && pin.semantic === "data" && pin.id === "element"
        ? {
            ...pin,
            valueType: blueprintElementValueType(elementType)
          }
        : pin
    );
  }
  if (def.type === BLUEPRINT_NODE_TYPE_FN_CALL) {
    const snapshot = readBlueprintFnSignatureSnapshot(params);
    if (!snapshot) {
      return typedBasePins;
    }
    const execInputPins = typedBasePins.filter((p) => p.kind === "input" && p.semantic === "exec");
    const execOutputPins = typedBasePins.filter(
      (p) => p.kind === "output" && p.semantic === "exec"
    );
    const paramInputs: BlueprintNodePinDef[] = snapshot.params.map((param) => ({
      id: param.pinId,
      kind: "input",
      semantic: "data",
      valueType: param.valueType,
      label: param.name,
      allowInlineLiteral: (BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES as readonly string[]).includes(
        param.valueType
      )
    }));
    const returnOutputs: BlueprintNodePinDef[] = snapshot.returns.map((ret) => ({
      id: ret.pinId,
      kind: "output",
      semantic: "data",
      valueType: ret.valueType,
      label: ret.name
    }));
    return [...execInputPins, ...paramInputs, ...execOutputPins, ...returnOutputs];
  }
  if (def.saveSchemaPins) {
    return withSaveSchemaPins(def, typedBasePins);
  }
  const cfg = def.dynamicInputPins;
  if (!cfg || !params) {
    return typedBasePins;
  }

  const extraIds = readDynamicInputPinIds(params, cfg.storageKey);
  const inputs = typedBasePins.filter((p) => p.kind === "input");
  const outputs = typedBasePins.filter((p) => p.kind === "output");

  const execInputs = inputs.filter((p) => p.semantic === "exec");
  const fixedDataInputs = inputs.filter(
    (p) => p.semantic === "data" && cfg.fixedDataInputIds.includes(p.id)
  );

  const labels = readDynamicInputPinLabels(params, cfg.pinLabelParamKey);
  const valueTypes = readDynamicInputPinValueTypes(params, cfg.pinValueTypeParamKey);
  const dynamicPins: BlueprintNodePinDef[] = [];
  let dynOrdinal = 0;
  // Counted per ADD rather than per pin: one add produces a whole group, so `dynOrdinal` runs at
  // two per button on a node whose template makes an input and an output together.
  const groupOrdinals = new Map<string, number>();
  for (const id of extraIds) {
    if (typedBasePins.some((p) => p.id === id)) {
      continue;
    }
    dynOrdinal += 1;
    const template = readDynamicPinTemplate(cfg, id);
    const groupId = readDynamicGroupBaseId(cfg, id);
    if (groupId !== undefined && !groupOrdinals.has(groupId)) {
      groupOrdinals.set(groupId, groupOrdinals.size + 1);
    }
    const groupOrdinal = groupId === undefined ? undefined : groupOrdinals.get(groupId);
    const kind = template?.kind ?? "input";
    const semantic = template?.semantic ?? "data";
    const isDataPin = semantic === "data";
    const valueType = isDataPin
      ? (valueTypes[id] ?? template?.valueType ?? cfg.valueType)
      : undefined;
    dynamicPins.push({
      id,
      kind,
      semantic,
      valueType,
      optional: template?.optional,
      allowInlineLiteral:
        kind === "input" && isDataPin
          ? (template?.allowInlineLiteral ?? cfg.allowInlineLiteral) &&
            (!cfg.pinValueTypeParamKey ||
              (BLUEPRINT_PIN_INLINE_LITERAL_VALUE_TYPES as readonly string[]).includes(
                valueType ?? ""
              ))
          : undefined,
      label:
        labels[id] ??
        (template
          ? cfg.numberGeneratedPinLabels && groupOrdinal !== undefined
            ? `${template.label} ${groupOrdinal}`
            : template.label
          : `${cfg.labelPrefix ?? "Input"} ${fixedDataInputs.length + dynOrdinal}`)
    });
  }

  const dynamicInputs = dynamicPins.filter((p) => p.kind === "input");
  const dynamicOutputs = dynamicPins.filter((p) => p.kind === "output");
  const insertBefore = cfg.outputInsertBeforePinId
    ? outputs.findIndex((p) => p.id === cfg.outputInsertBeforePinId)
    : -1;
  const staticOutputsBeforeDynamic = insertBefore >= 0 ? outputs.slice(0, insertBefore) : outputs;
  const staticOutputsAfterDynamic = insertBefore >= 0 ? outputs.slice(insertBefore) : [];

  return [
    ...execInputs,
    ...fixedDataInputs,
    ...dynamicInputs,
    ...staticOutputsBeforeDynamic,
    ...dynamicOutputs,
    ...staticOutputsAfterDynamic
  ];
}

function pinDefToCatalogPin(p: BlueprintNodePinDef, removable: boolean): EffectiveCatalogPin {
  return {
    id: p.id,
    kind: p.kind,
    semantic: p.semantic,
    valueType: p.valueType,
    label: p.label,
    optional: p.optional,
    allowInlineLiteral: p.allowInlineLiteral,
    // Carried through so the reverse-lookup index can read asset-bearing pins off the catalogue.
    // Dropping it here is silent: the index would simply stop seeing those references.
    assetRef: p.assetRef,
    removable
  };
}

/**
 * Editor catalog entry with pins merged from params (dynamic inputs + removable flags).
 */
export function resolveEffectiveBlueprintCatalogEntry(
  def: BlueprintNodeDef,
  params?: Record<string, unknown>
): BlueprintNodeEditorCatalogEntry {
  const cfg = def.dynamicInputPins;
  const base = {
    type: def.type,
    category: def.category,
    displayName: def.displayName,
    keywords: def.keywords,
    isPure: def.isPure,
    inspectorParams: def.inspectorParams,
    graphKinds: def.graphKinds,
    role: def.role,
    scope: def.scope,
    dynamicInputPinLabelParamKey: cfg?.pinLabelParamKey,
    dynamicInputPinAddLabel: cfg?.addButtonLabel,
    dynamicInputPinTypeParamKey: cfg?.pinValueTypeParamKey,
    dynamicInputPinTypeOptions: cfg?.pinValueTypeOptions,
    dynamicPinsGenerateOutputs: cfg?.editableGeneratedOutputPins,
    supportsSaveSchemaPins: Boolean(def.saveSchemaPins),
    saveSchemaPinKind: def.saveSchemaPins?.kind
  };

  const effective = resolveEffectiveBlueprintNodePins(def, params);
  const dynamicIdSet = cfg
    ? new Set(readDynamicInputPinIds(params, cfg.storageKey))
    : new Set<string>();

  const pins: EffectiveCatalogPin[] = effective.map((p) => {
    const removable =
      Boolean(cfg) &&
      p.semantic === "data" &&
      (p.kind === "input" || Boolean(cfg?.editableGeneratedOutputPins)) &&
      dynamicIdSet.has(p.id);
    return pinDefToCatalogPin(p, removable);
  });

  return {
    ...base,
    pins,
    supportsDynamicInputPins: Boolean(def.dynamicInputPins)
  };
}
