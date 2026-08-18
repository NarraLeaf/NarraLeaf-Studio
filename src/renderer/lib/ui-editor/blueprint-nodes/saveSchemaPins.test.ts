import { afterEach, describe, expect, it } from "vitest";
import {
  BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
  BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE
} from "@shared/types/blueprint/graph";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import type { SaveSchemaField } from "@shared/types/saveSchema";
import { gameBlueprintNodes } from "./built-in";
import {
  resolveEffectiveBlueprintNodePins,
  saveSchemaFieldIdFromPin,
  saveSchemaPinId
} from "./effectivePins";

const CHAPTER: SaveSchemaField = {
  id: "f-chapter",
  name: "Chapter",
  valueType: "string",
  storageKey: "chapter",
  defaultValue: "Prologue",
  order: 0
};

const PLAY_TIME: SaveSchemaField = {
  id: "f-play-time",
  name: "Play Time",
  valueType: "integer",
  storageKey: "play_time",
  order: 1
};

function def(type: string) {
  const found = gameBlueprintNodes.find((node) => node.type === type);
  if (!found) {
    throw new Error(`node not registered: ${type}`);
  }
  return found;
}

afterEach(() => {
  setActiveSaveSchemaFields([]);
});

describe("save schema pins", () => {
  it("leaves both nodes exactly as they were when the project declares nothing", () => {
    // The state every project written before the schema existed is in, and a working one: the
    // raw `metadata` pin is still the whole author-side channel.
    const write = resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE), {});
    const read = resolveEffectiveBlueprintNodePins(
      def(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA),
      {}
    );
    expect(write.map((pin) => pin.id)).toEqual(["in", "next", "id", "metadata", "screenshot"]);
    expect(read.map((pin) => pin.id)).toEqual(["in", "next", "id", "metadata"]);
  });

  it("grows one input pin per field on Save Game, in schema order", () => {
    setActiveSaveSchemaFields([CHAPTER, PLAY_TIME]);
    const pins = resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE), {});
    const grown = pins.filter((pin) => saveSchemaFieldIdFromPin(pin.id) !== null);
    expect(grown.map((pin) => pin.id)).toEqual([
      saveSchemaPinId("f-chapter"),
      saveSchemaPinId("f-play-time")
    ]);
    expect(grown.every((pin) => pin.kind === "input")).toBe(true);
    // The field's declared type IS the pin's type - there is no mapping table between them.
    expect(grown.map((pin) => pin.valueType)).toEqual(["string", "integer"]);
    expect(grown.map((pin) => pin.label)).toEqual(["Chapter", "Play Time"]);
    // Fillable on the card, which is the difference between declaring a chapter name once and
    // wiring a String node into every one of six slots.
    expect(grown.every((pin) => pin.allowInlineLiteral)).toBe(true);
  });

  it("grows the same fields as outputs on Get Save Metadata", () => {
    setActiveSaveSchemaFields([CHAPTER, PLAY_TIME]);
    const pins = resolveEffectiveBlueprintNodePins(
      def(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA),
      {}
    );
    const grown = pins.filter((pin) => saveSchemaFieldIdFromPin(pin.id) !== null);
    expect(grown.map((pin) => pin.id)).toEqual([
      saveSchemaPinId("f-chapter"),
      saveSchemaPinId("f-play-time")
    ]);
    expect(grown.every((pin) => pin.kind === "output")).toBe(true);
    // Nothing to type into an output; offering an inline literal there would be a dead control.
    expect(grown.some((pin) => pin.allowInlineLiteral)).toBe(false);
  });

  it("keeps the raw metadata pin on both nodes once fields exist", () => {
    // Taking it away would silently drop the edge on every graph that was reading or writing the
    // blob, at the moment the author declared their first field.
    setActiveSaveSchemaFields([CHAPTER]);
    expect(
      resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE), {}).some(
        (pin) => pin.id === "metadata" && pin.kind === "input"
      )
    ).toBe(true);
    expect(
      resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA), {}).some(
        (pin) => pin.id === "metadata" && pin.kind === "output"
      )
    ).toBe(true);
  });

  it("addresses a pin by field id, so a rename does not move it", () => {
    setActiveSaveSchemaFields([CHAPTER]);
    const before = resolveEffectiveBlueprintNodePins(
      def(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE),
      {}
    ).find((pin) => saveSchemaFieldIdFromPin(pin.id) !== null);
    setActiveSaveSchemaFields([{ ...CHAPTER, name: "Act", storageKey: "chapter" }]);
    const after = resolveEffectiveBlueprintNodePins(
      def(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE),
      {}
    ).find((pin) => saveSchemaFieldIdFromPin(pin.id) !== null);
    expect(after?.id).toBe(before?.id);
    expect(after?.label).toBe("Act");
  });
});
