import { createBuiltInTests, type BuiltInTestHost } from "./builtin";
import { testTextSortKey } from "./testText";
import {
  TEST_CATEGORY_ORDER,
  type RegisteredTest,
  type TestCategory,
  type TestDefinition,
  type TestId
} from "./types";

/**
 * The test registry (ruling R2).
 *
 * Shaped after `WidgetModuleRegistry` rather than after the blueprint node registry, and the
 * difference is the whole reason: a blueprint node is deliberately *not* removable (a graph that
 * already uses one would lose its node type under it), whereas a test is a thing you run on demand
 * and nothing in the project points at it. So a plugin unload has to be able to reclaim its tests,
 * which is what the disposer returned from {@link TestRegistry.register} is for.
 *
 * Two invariants are enforced here rather than trusted:
 *
 *  - **`ownerPluginId` comes from the host.** It is assigned from the identity of the plugin whose
 *    code is registering, never read off the definition - which is a value the plugin controls.
 *  - **A plugin's id must be prefixed with its plugin id**, so one plugin cannot register (or
 *    replace) `narraleaf-studio:project-diagnostics`, or another plugin's test, by naming it.
 */

export type TestRegisterOptions = {
  /** Assigned by the host from the registering plugin's identity. Absent means core. */
  ownerPluginId?: string;
  /** A plugin reloading itself re-registers its own ids; it may never replace anyone else's. */
  replaceExisting?: boolean;
};

/** Where a definition that claims no category lands. */
const DEFAULT_TEST_CATEGORY: TestCategory = "custom";

/**
 * Separators a plugin-owned id may use after its plugin id.
 *
 * Both are accepted because the two neighbouring conventions disagree - Studio's own tests are
 * `narraleaf-studio:project-diagnostics` while plugin blueprint nodes are `<pluginId>.<type>` - and
 * the property being enforced is ownership, not punctuation. Rejecting the "wrong" one would only
 * break plugins over a spelling the host has no reason to care about.
 */
const PLUGIN_ID_SEPARATORS = [":", "."] as const;

function isOwnedIdPrefixed(id: TestId, ownerPluginId: string): boolean {
  return PLUGIN_ID_SEPARATORS.some((separator) => id.startsWith(`${ownerPluginId}${separator}`));
}

function categoryRank(category: TestCategory | undefined): number {
  const index = TEST_CATEGORY_ORDER.indexOf(category ?? DEFAULT_TEST_CATEGORY);
  return index === -1 ? TEST_CATEGORY_ORDER.length : index;
}

/** Category order, then title, then id - stable and locale-independent (see `testTextSortKey`). */
function compareRegisteredTests(a: RegisteredTest, b: RegisteredTest): number {
  const byCategory = categoryRank(a.definition.category) - categoryRank(b.definition.category);
  if (byCategory !== 0) {
    return byCategory;
  }
  const aTitle = testTextSortKey(a.definition.title);
  const bTitle = testTextSortKey(b.definition.title);
  if (aTitle !== bTitle) {
    return aTitle < bTitle ? -1 : 1;
  }
  return a.definition.id === b.definition.id ? 0 : a.definition.id < b.definition.id ? -1 : 1;
}

export class TestRegistry {
  private readonly tests = new Map<TestId, TestDefinition>();
  /** id -> owning plugin id, for tests contributed by a plugin. */
  private readonly owners = new Map<TestId, string>();
  private builtInsSeeded = false;

  /**
   * Put a definition in the registry. Returns the disposer that takes it back out.
   *
   * Throws on a duplicate id unless `replaceExisting`, and then only for the same owner: a
   * silently overwritten test would run something other than what the picker's row said, which is
   * the one failure a test framework cannot afford.
   */
  public register(definition: TestDefinition, options?: TestRegisterOptions): () => void {
    const id = definition.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("A test definition needs a non-empty id");
    }
    if (typeof definition.run !== "function") {
      throw new Error(`Test ${id} has no run()`);
    }

    const ownerPluginId = options?.ownerPluginId;
    if (ownerPluginId && !isOwnedIdPrefixed(id, ownerPluginId)) {
      throw new Error(`A plugin's test id must be prefixed with its plugin id: ${ownerPluginId}`);
    }

    if (this.tests.has(id)) {
      const existingOwner = this.owners.get(id);
      if (!options?.replaceExisting) {
        throw new Error(`Test already registered: ${id}`);
      }
      if (existingOwner !== ownerPluginId) {
        throw new Error(
          `Test ${id} belongs to ${existingOwner ?? "Studio"} and cannot be replaced by ` +
            `${ownerPluginId ?? "Studio"}`
        );
      }
    }

    this.tests.set(id, definition);
    if (ownerPluginId) {
      this.owners.set(id, ownerPluginId);
    } else {
      this.owners.delete(id);
    }

    // Identity-checked: a plugin that replaced its own test then ran the *first* registration's
    // disposer would otherwise reclaim the replacement it just installed.
    return () => {
      if (this.tests.get(id) === definition) {
        this.unregister(id);
      }
    };
  }

  public unregister(id: TestId): boolean {
    this.owners.delete(id);
    return this.tests.delete(id);
  }

  /** Everything one plugin contributed, in one call - what a plugin unload needs. */
  public unregisterOwner(ownerPluginId: string): TestId[] {
    const removed: TestId[] = [];
    for (const [id, owner] of [...this.owners.entries()]) {
      if (owner === ownerPluginId) {
        this.unregister(id);
        removed.push(id);
      }
    }
    return removed;
  }

  public get(id: TestId): RegisteredTest | undefined {
    const definition = this.tests.get(id);
    if (!definition) {
      return undefined;
    }
    return this.toRegistered(definition);
  }

  public has(id: TestId): boolean {
    return this.tests.has(id);
  }

  public list(): RegisteredTest[] {
    return [...this.tests.values()]
      .map((definition) => this.toRegistered(definition))
      .sort(compareRegisteredTests);
  }

  /** The plugin id that owns a test, or undefined for Studio's own. */
  public getOwner(id: TestId): string | undefined {
    return this.owners.get(id);
  }

  /** Plugin ids that currently contribute at least one test. */
  public getOwnerPluginIds(): string[] {
    return [...new Set(this.owners.values())];
  }

  /**
   * Seed Studio's own tests, once.
   *
   * Lazy and idempotent, and called defensively from the top of every read on `TestRunService`
   * (the same discipline as `BlueprintNodeCatalogService.ensureBuiltinsRegistered`): the picker
   * can be opened before anything else has touched this module, and an empty list would read as
   * "this project has no checks" rather than as "nobody seeded the registry yet".
   *
   * The host is passed in rather than imported so a built-in never captures a workspace: it is
   * read on each `run()`, and a service singleton outlives the project it was initialised for.
   */
  public ensureBuiltInTestsRegistered(host: BuiltInTestHost): void {
    if (this.builtInsSeeded) {
      return;
    }
    // Set first: `register` reads nothing back out, but a definition factory that ever did
    // would otherwise recurse through this method forever.
    this.builtInsSeeded = true;
    for (const definition of createBuiltInTests(host)) {
      this.register(definition);
    }
  }

  private toRegistered(definition: TestDefinition): RegisteredTest {
    const ownerPluginId = this.owners.get(definition.id);
    return ownerPluginId ? { definition, ownerPluginId } : { definition };
  }
}

/**
 * The window's registry.
 *
 * Module-level for the same reason the widget module registry is: one window holds one project, so
 * "the tests available here" is a per-window fact, and a plugin registering from its own module has
 * no service handle to reach for.
 */
export const testRegistry = new TestRegistry();
