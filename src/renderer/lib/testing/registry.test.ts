import { describe, expect, it, vi } from "vitest";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import {
  PROJECT_DIAGNOSTICS_SLUG,
  PROJECT_DIAGNOSTICS_TEST_ID,
  type BuiltInTestHost
} from "./builtin";
import { TestRegistry } from "./registry";
import { deriveBuiltInTestSlug, type TestDefinition } from "./types";

// The built-in definition reaches the workspace through its host, so the import graph touches the
// service registry. Nothing here runs a test, so an empty bridge is enough.
vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => ({}),
  getPrivilegedInterface: () => ({})
}));

const host: BuiltInTestHost = { services: () => ({}) as ServiceRegistry };

function definition(id: string, patch: Partial<TestDefinition> = {}): TestDefinition {
  return {
    id,
    title: { text: id },
    presentation: "headless",
    run: () => ({ status: "passed" }),
    ...patch
  };
}

describe("TestRegistry", () => {
  it("refuses a duplicate id unless the caller asks to replace it", () => {
    const registry = new TestRegistry();
    registry.register(definition("core:one"));

    expect(() => registry.register(definition("core:one"))).toThrow(/already registered/);

    const replacement = definition("core:one", { title: { text: "replaced" } });
    registry.register(replacement, { replaceExisting: true });
    expect(registry.get("core:one")?.definition).toBe(replacement);
  });

  it("refuses a plugin id that is not prefixed with the plugin id", () => {
    const registry = new TestRegistry();

    expect(() =>
      registry.register(definition("somethingElse:x"), { ownerPluginId: "acme" })
    ).toThrow(/prefixed with its plugin id/);
    // A plugin must not be able to name a Studio test into existence either.
    expect(() =>
      registry.register(definition(PROJECT_DIAGNOSTICS_TEST_ID), { ownerPluginId: "acme" })
    ).toThrow(/prefixed with its plugin id/);

    // Both separators are accepted: the property enforced is ownership, not punctuation.
    registry.register(definition("acme:colon"), { ownerPluginId: "acme" });
    registry.register(definition("acme.dot"), { ownerPluginId: "acme" });
    expect(registry.getOwner("acme:colon")).toBe("acme");
    expect(registry.getOwner("acme.dot")).toBe("acme");
  });

  it("lets a plugin replace only its own test", () => {
    const registry = new TestRegistry();
    registry.register(definition("acme:one"), { ownerPluginId: "acme" });
    registry.register(definition("core:one"));

    // Another plugin cannot take it, even claiming a replace...
    expect(() =>
      registry.register(definition("acme:one"), { ownerPluginId: "other", replaceExisting: true })
    ).toThrow(/prefixed with its plugin id/);
    // ...and a plugin cannot take over one of Studio's.
    expect(() =>
      registry.register(definition("core:one"), { ownerPluginId: "core", replaceExisting: true })
    ).toThrow(/belongs to Studio/);

    const reloaded = definition("acme:one", { title: { text: "reloaded" } });
    registry.register(reloaded, { ownerPluginId: "acme", replaceExisting: true });
    expect(registry.get("acme:one")?.definition).toBe(reloaded);
    expect(registry.get("acme:one")?.ownerPluginId).toBe("acme");
  });

  it("reclaims what a plugin registered", () => {
    const registry = new TestRegistry();
    const disposeOne = registry.register(definition("acme:one"), { ownerPluginId: "acme" });
    registry.register(definition("acme:two"), { ownerPluginId: "acme" });
    registry.register(definition("core:one"));

    disposeOne();
    expect(registry.has("acme:one")).toBe(false);
    // Idempotent, and it never reaches past its own registration.
    disposeOne();

    expect(registry.unregisterOwner("acme")).toEqual(["acme:two"]);
    expect(registry.getOwnerPluginIds()).toEqual([]);
    // Studio's own survives a plugin unload.
    expect(registry.has("core:one")).toBe(true);
  });

  it("does not let a stale disposer reclaim the registration that replaced it", () => {
    const registry = new TestRegistry();
    const disposeFirst = registry.register(definition("acme:one"), { ownerPluginId: "acme" });
    const reloaded = definition("acme:one", { title: { text: "reloaded" } });
    registry.register(reloaded, { ownerPluginId: "acme", replaceExisting: true });

    disposeFirst();

    expect(registry.get("acme:one")?.definition).toBe(reloaded);
  });

  it("seeds the built-in tests once, however often it is asked", () => {
    const registry = new TestRegistry();

    registry.ensureBuiltInTestsRegistered(host);
    registry.ensureBuiltInTestsRegistered(host);
    registry.ensureBuiltInTestsRegistered(host);

    const builtIns = registry
      .list()
      .filter((test) => test.definition.id === PROJECT_DIAGNOSTICS_TEST_ID);
    expect(builtIns).toHaveLength(1);
    expect(builtIns[0].ownerPluginId).toBeUndefined();
    expect(builtIns[0].definition.presentation).toBe("headless");
    // Ruling R9: a headless test is a read-only observer, so it declares nothing to reach for.
    expect(builtIns[0].definition.requires).toEqual([]);
  });

  it("names the built-in's i18n keys after the id they are derived from", () => {
    // If the id is ever renamed, this fails rather than leaving `test.builtin.projectDiagnostics.*`
    // behind as dead keys nothing addresses.
    expect(deriveBuiltInTestSlug(PROJECT_DIAGNOSTICS_TEST_ID)).toBe(PROJECT_DIAGNOSTICS_SLUG);
  });

  it("lists tests in category order, then title", () => {
    const registry = new TestRegistry();
    registry.register(definition("z:custom", { title: { text: "aaa" } }));
    registry.register(definition("a:runtime", { category: "runtime", title: { text: "zzz" } }));
    registry.register(
      definition("b:integrity-b", { category: "integrity", title: { text: "bbb" } })
    );
    registry.register(
      definition("c:integrity-a", { category: "integrity", title: { text: "aaa" } })
    );

    expect(registry.list().map((test) => test.definition.id)).toEqual([
      "c:integrity-a",
      "b:integrity-b",
      "a:runtime",
      // No category declared: `custom` is where a definition that claims nothing lands.
      "z:custom"
    ]);
  });
});
