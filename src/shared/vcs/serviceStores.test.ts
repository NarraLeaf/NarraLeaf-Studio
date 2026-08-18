import { describe, expect, it } from "vitest";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";
import { SERVICE_STORE_LOCATIONS, isStudioStateStore, serviceStoreLocation } from "./serviceStores";
import { isVersioned } from "./workingSet";

/**
 * The classification held against the thing it exists to control: whether the store
 * ends up under version control.
 *
 * The two directories are spelled out here rather than imported from
 * `ProjectNameConvention` (renderer-land). `ServiceAssetsService.test.ts` asserts the
 * other half - that the service really resolves a store into the directory its
 * classification names - so between the two files there is no gap where the table
 * says one thing and the writer does another.
 */
const DIRECTORY: Record<string, string> = {
  studio: ".nlstudio/services",
  project: "editor/services"
};

describe("service store classification", () => {
  it("classifies every store Studio itself writes", () => {
    expect(serviceStoreLocation("panel_state")).toBe("studio");
    expect(serviceStoreLocation("notification_history")).toBe("studio");
    expect(serviceStoreLocation("recent_colors")).toBe("studio");
    // A merge in progress writes nothing until Finish, so the half-filled form is Studio's
    // state - and it has to be writable while that same merge has the workspace frozen, which
    // `editor/services/` is not.
    expect(serviceStoreLocation("merge_decisions")).toBe("studio");
    // The author's cast. Moving this out of the versioned tree is the failure the
    // whole table is arranged to prevent.
    expect(serviceStoreLocation("character")).toBe("project");
  });

  it("treats a plugin store as the game capability's content, by default", () => {
    // The Gallery's catalog: authored in Studio, inlined into the shipped bundle by
    // pluginRuntimeData.ts. Nothing lists it - it takes the default, which is the point.
    const gallery = pluginStoreNamespace("narraleaf.gallery", "narraleaf.gallery.items");
    expect(SERVICE_STORE_LOCATIONS).not.toHaveProperty(gallery);
    expect(serviceStoreLocation(gallery)).toBe("project");
  });

  it("defaults an unknown store to project content", () => {
    // The asymmetry: over-freezing a store costs a preference, under-freezing it
    // costs the author something no revision can give back.
    expect(serviceStoreLocation("some_store_added_next_year")).toBe("project");
    expect(isStudioStateStore("some_store_added_next_year")).toBe(false);
  });

  it("puts exactly the Studio-state stores outside the working set", () => {
    for (const [namespace, location] of Object.entries(SERVICE_STORE_LOCATIONS)) {
      const path = `${DIRECTORY[location]}/${namespace}.json`;
      expect([namespace, isVersioned(path)]).toEqual([namespace, location === "project"]);
    }

    expect(isVersioned(".nlstudio/services/panel_state.json")).toBe(false);
    expect(isVersioned("editor/services/character.json")).toBe(true);
  });
});
