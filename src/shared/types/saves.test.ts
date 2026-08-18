import { describe, expect, it } from "vitest";
import {
  AUTO_SAVE_ID_PREFIX,
  DEFAULT_AUTO_SAVE_CONFIGURATION,
  autoSaveSlotId,
  isAutoSaveId,
  normalizeAutoSaveConfiguration,
  parseAutoSaveSlotIndex
} from "./saves";

describe("auto save configuration", () => {
  it("gives projects that never configured it the defaults", () => {
    expect(normalizeAutoSaveConfiguration(undefined)).toEqual(DEFAULT_AUTO_SAVE_CONFIGURATION);
    expect(normalizeAutoSaveConfiguration(null)).toEqual(DEFAULT_AUTO_SAVE_CONFIGURATION);
    expect(normalizeAutoSaveConfiguration("nonsense")).toEqual(DEFAULT_AUTO_SAVE_CONFIGURATION);
    // The default matters: autosaving must be ON for a project written
    // before the feature existed.
    expect(DEFAULT_AUTO_SAVE_CONFIGURATION.enabled).toBe(true);
  });

  it("keeps authored values and fills only what is missing", () => {
    expect(normalizeAutoSaveConfiguration({ enabled: false })).toEqual({
      ...DEFAULT_AUTO_SAVE_CONFIGURATION,
      enabled: false
    });
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: 30, slots: 9 })).toEqual({
      enabled: true,
      intervalSeconds: 30,
      slots: 9
    });
  });

  it("clamps out-of-range and non-integer numbers instead of storing them", () => {
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: 0 }).intervalSeconds).toBe(1);
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: -5 }).intervalSeconds).toBe(1);
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: 10_000 }).intervalSeconds).toBe(600);
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: 7.9 }).intervalSeconds).toBe(7);
    expect(normalizeAutoSaveConfiguration({ slots: 0 }).slots).toBe(1);
    expect(normalizeAutoSaveConfiguration({ slots: 999 }).slots).toBe(20);
  });

  it("falls back rather than storing NaN for unparseable numbers", () => {
    expect(normalizeAutoSaveConfiguration({ intervalSeconds: "soon" }).intervalSeconds).toBe(
      DEFAULT_AUTO_SAVE_CONFIGURATION.intervalSeconds
    );
    expect(normalizeAutoSaveConfiguration({ slots: {} }).slots).toBe(
      DEFAULT_AUTO_SAVE_CONFIGURATION.slots
    );
  });
});

describe("auto save slot ids", () => {
  it("round-trips a slot index", () => {
    expect(autoSaveSlotId(0)).toBe(`${AUTO_SAVE_ID_PREFIX}0`);
    expect(parseAutoSaveSlotIndex(autoSaveSlotId(7))).toBe(7);
  });

  it("keeps the reserved namespace apart from player save ids", () => {
    expect(isAutoSaveId(autoSaveSlotId(2))).toBe(true);
    expect(isAutoSaveId("slot-1")).toBe(false);
    expect(isAutoSaveId("narraleaf.quick-save.slot")).toBe(false);
    expect(parseAutoSaveSlotIndex("slot-1")).toBeNull();
  });

  it("rejects reserved-looking ids that are not well-formed slots", () => {
    expect(parseAutoSaveSlotIndex(`${AUTO_SAVE_ID_PREFIX}latest`)).toBeNull();
    expect(parseAutoSaveSlotIndex(`${AUTO_SAVE_ID_PREFIX}-1`)).toBeNull();
    expect(parseAutoSaveSlotIndex(`${AUTO_SAVE_ID_PREFIX}`)).toBeNull();
  });

  it("survives the runtime save id rules (no path segments, no control chars)", () => {
    const id = autoSaveSlotId(3);
    expect(
      [...id].every((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code > 0x1f && code !== 0x7f;
      })
    ).toBe(true);
    expect(id).not.toMatch(/[\\/]/);
    expect(id).not.toBe(".");
    expect(id).not.toBe("..");
  });
});
