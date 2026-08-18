import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEYBINDING_CATALOG, getKeybindingCatalogEntry } from "./keybindingCatalog";
import { parseKeybinding } from "./KeybindingService";
import { flattenCatalog } from "@shared/i18n/flatten";
import { en } from "@shared/i18n/catalog/en";
import { zh } from "@shared/i18n/catalog/zh";

describe("KEYBINDING_CATALOG", () => {
  it("has unique ids", () => {
    const ids = KEYBINDING_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares parseable default chords", () => {
    for (const entry of KEYBINDING_CATALOG) {
      const parsed = parseKeybinding(entry.key, true);
      expect(parsed.key, `catalog entry ${entry.id} has no base key`).not.toBe("");
    }
  });

  it("resolves entries by id", () => {
    expect(getKeybindingCatalogEntry("story.duplicate")).toMatchObject({ key: "mod+d" });
    expect(getKeybindingCatalogEntry("nope")).toBeUndefined();
  });

  it("gives every entry an i18n label and category", () => {
    for (const entry of KEYBINDING_CATALOG) {
      expect(entry.labelKey.length, entry.id).toBeGreaterThan(0);
      expect(
        entry.categoryKey.startsWith("workspace.shell.keybindings.categories."),
        entry.id
      ).toBe(true);
    }
  });

  it("labels every entry with a key that both locales actually translate", () => {
    // `entry()` casts its label through `as TranslationKey`, so a typo or a key nobody wrote
    // compiles and then renders as a raw dotted string in the settings table.
    const enKeys = new Set(flattenCatalog(en).keys());
    const zhKeys = new Set(flattenCatalog(zh).keys());
    const missing = KEYBINDING_CATALOG.flatMap((entry) => [
      ...(enKeys.has(entry.labelKey) ? [] : [`${entry.id} -> en:${entry.labelKey}`]),
      ...(zhKeys.has(entry.labelKey) ? [] : [`${entry.id} -> zh:${entry.labelKey}`])
    ]);
    expect(missing).toEqual([]);
  });
});

/**
 * Every keybinding a component declares must have a catalog entry, agreeing on the chord.
 *
 * This is not bookkeeping. `KeybindingService.getEffectiveKey` - which the *dispatch* path calls on
 * every keystroke - resolves override → catalog entry → inline `key`, so the catalog **outranks**
 * the key written next to the handler. A component that changes its own `key` without changing the
 * catalog changes nothing; a component that adds a binding whose id has no catalog entry gets its
 * inline key, which may already be spoken for by whatever the catalog still points at the old
 * chord. Both happened here at once: the audio preview moved its repeat toggle off `l` and added a
 * loop marker on `l`, the catalog kept the toggle on `l`, and dispatch breaks on the first match -
 * so the new binding was permanently shadowed and its replacement chord was dead.
 *
 * Source scanning rather than mounting components: registration is lazy and per tab, so nothing
 * short of rendering every editor enumerates these at runtime, and a test that has to render an
 * editor to check a shortcut is a test nobody keeps green.
 */
describe("catalog coverage of declared keybindings", () => {
  const RENDERER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        return item.name === "node_modules" ? [] : sourceFiles(full);
      }
      return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [full] : [];
    });
  }

  interface Declaration {
    catalogId: string;
    /** Absent when the component computes its chord instead of writing a literal. */
    key: string | null;
    /**
     * The `useKeybindings` array this came from, or null for a standalone `useKeybinding`.
     *
     * One array is registered under one `when`, so all of its bindings are live together.
     * Standalone calls carry their own `when` - `editor.close-active-tab` and
     * `editor.close-selected-tabs` share ⌘W on purpose, scoped to the editor body and the tab
     * strip - so they are not comparable and must not be lumped in by their id prefix.
     */
    set: string | null;
    where: string;
  }

  const declarations: Declaration[] = sourceFiles(RENDERER_ROOT).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const where = path.relative(RENDERER_ROOT, file).replace(/\\/g, "/");
    const found: Declaration[] = [];

    // `useKeybindings({ keybindings: [{ id, key, … }], catalogPrefix })` - the batch form.
    // Every definition in a file that names a prefix belongs to that prefix.
    const prefix = /catalogPrefix:\s*"([^"]+)"/.exec(source)?.[1];
    if (prefix) {
      for (const match of source.matchAll(/\bid:\s*"([^"]+)"\s*,\s*key:\s*"([^"]+)"/g)) {
        found.push({
          catalogId: `${prefix}${match[1]}`,
          key: match[2],
          set: `${where}#${prefix}`,
          where
        });
      }
    }

    // `useKeybinding({ catalogId, key, … })` - the single form, where the registration id is
    // per instance and the catalog id is spelled out. The chord may sit either side of it.
    for (const match of source.matchAll(/catalogId:\s*"([^"]+)"/g)) {
      const from = Math.max(0, match.index - 300);
      const window = source.slice(from, match.index + 300);
      const keys = [...window.matchAll(/\bkey:\s*"([^"]+)"/g)].map((hit) => hit[1]);
      found.push({
        catalogId: match[1],
        key: keys.length === 1 ? keys[0] : null,
        set: null,
        where
      });
    }
    return found;
  });

  it("finds the declarations it is supposed to be checking", () => {
    // A scanner that silently matches nothing would pass every assertion below.
    expect(declarations.length).toBeGreaterThan(50);
    expect(declarations.map((item) => item.catalogId)).toContain("assets.audio.mark-loop");
  });

  it("gives every declared binding a catalog entry", () => {
    const orphans = declarations
      .filter((item) => getKeybindingCatalogEntry(item.catalogId) === undefined)
      .map((item) => `${item.catalogId} (${item.where}) has no KEYBINDING_CATALOG entry`);
    expect(orphans).toEqual([]);
  });

  it("never resolves two bindings in one registration set to the same chord", () => {
    // Bindings sharing a `catalogPrefix` are registered together by one component under one
    // `when`, so they are all live at once - and dispatch stops at the first match. Two of them
    // on one chord means the later one can never fire, which is the exact shape of the bug this
    // file exists for: the catalog still pointed the repeat toggle at `l` while the new loop
    // marker declared `l`, so the marker was permanently shadowed.
    const byChord = new Map<string, string[]>();
    for (const item of declarations) {
      const effective = getKeybindingCatalogEntry(item.catalogId)?.key ?? item.key;
      if (item.set === null || effective === null) {
        continue;
      }
      const bucket = `${item.set} ${effective}`;
      byChord.set(bucket, [...(byChord.get(bucket) ?? []), item.catalogId]);
    }
    const shadowed = [...byChord.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([bucket, ids]) => `${bucket} is claimed by ${ids.join(" and ")}`);
    expect(shadowed).toEqual([]);
  });

  it("agrees with the catalog about which chord each binding uses", () => {
    const conflicts = declarations
      .filter((item) => item.key !== null)
      .flatMap((item) => {
        const entry = getKeybindingCatalogEntry(item.catalogId);
        return entry && entry.key !== item.key
          ? [
              `${item.catalogId} (${item.where}): declares "${item.key}", catalog says "${entry.key}"`
            ]
          : [];
      });
    expect(conflicts).toEqual([]);
  });
});
