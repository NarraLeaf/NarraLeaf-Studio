import { describe, it, expect } from "vitest";
import { SIDEBAR_GROUP_ID, weaveGroupSlot } from "./sidebarPanelGroup";

const G = SIDEBAR_GROUP_ID;

describe("weaveGroupSlot", () => {
  it("puts the group last when the stored order says nothing about it", () => {
    expect(weaveGroupSlot(["A", "B"], undefined)).toEqual(["A", "B", G]);
    expect(weaveGroupSlot(["A", "B"], ["A", "B"])).toEqual(["A", "B", G]);
  });

  it("restores the recorded slot", () => {
    expect(weaveGroupSlot(["A", "B", "C"], ["A", G, "B", "C"])).toEqual(["A", G, "B", "C"]);
  });

  it("puts the group first when nothing precedes it", () => {
    expect(weaveGroupSlot(["A", "B"], [G, "A", "B"])).toEqual([G, "A", "B"]);
  });

  it("anchors to the nearest surviving predecessor when panels went missing", () => {
    // "B" is recorded before the group but is not registered in this window (a plugin panel
    // from another install); the group falls back to sitting after "A".
    expect(weaveGroupSlot(["A", "C"], ["A", "B", G, "C"])).toEqual(["A", G, "C"]);
  });

  it("puts the group first when every recorded predecessor is gone", () => {
    expect(weaveGroupSlot(["C"], ["A", "B", G, "C"])).toEqual([G, "C"]);
  });

  it("handles an empty dock", () => {
    expect(weaveGroupSlot([], ["A", G])).toEqual([G]);
  });
});
