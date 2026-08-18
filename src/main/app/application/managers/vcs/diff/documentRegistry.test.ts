import path from "path";
import { describe, expect, it } from "vitest";
import esbuild from "esbuild";
import { listDocumentSpecs } from "@shared/documents/registry";
import { specForDocumentPath } from "./documentDiff";

/**
 * The registry is populated in the MAIN process, where the diff engine runs.
 *
 * Registration is an import side effect (`@shared/documents/specs`), and until this
 * milestone every importer of that module was a renderer service - so in the main
 * process the registry was empty and `resolveDocumentSpecForPath` answered `undefined`
 * for everything. Nothing anywhere reported that: an empty registry is
 * indistinguishable from "no spec claims this path", which is the ordinary answer for
 * most of a repository. The whole semantic tier would simply have degraded to the
 * generic JSON one, permanently and silently, on documents that have a spec.
 *
 * So it is asserted from both ends: that the module the engine imports really registers
 * (below), and that the main process's own entry point statically reaches it, since an
 * engine nobody loads registers nothing.
 */

const MAIN_ENTRY = path.resolve(__dirname, "../../../../../index.ts");
const ROOT = path.resolve(__dirname, "../../../../../../..");

/** Externals must match the real build; see project/build/build-main.js. */
const EXTERNAL = ["electron", "esbuild", "@narraleaf/encryption", "koffi"];

describe("document specs are registered in the main process", () => {
  it("has a non-empty registry once the diff engine is loaded", () => {
    // This test file deliberately does not import `@shared/documents/specs` itself. If
    // the only import of it in this module graph were the one in this line's absence,
    // the assertion would pass for the wrong reason.
    expect(listDocumentSpecs().length).toBeGreaterThan(0);
  });

  it("resolves a known project path to its spec", () => {
    expect(specForDocumentPath("editor/audio-tracks.json")?.kind).toBe("audio-tracks");
    expect(specForDocumentPath("editor/localization/keys.json")?.kind).toBe("localization-keys");
  });

  /**
   * The three formats D4 added, and the one way their implementation can be present and never
   * called: `defineDocumentSpec` has to FORWARD `diff` from the definition onto the spec. A
   * definition that dropped it produces a spec whose `diff` is `undefined`, which is exactly what
   * `diffDocumentBytes` reads to fall back to the summary tier - so the author would get a
   * working, plausible, lesser answer, with nothing anywhere reporting that the semantic diff
   * somebody wrote is dead code.
   */
  it("resolves the wave-2 documents and keeps the semantic diff they declare", () => {
    const paths = {
      characters: "editor/services/character.json",
      story: "editor/story/stories/story-1/storydoc.json",
      "assets-metadata": "assets/assets.metadata.image.json"
    };

    for (const [kind, path] of Object.entries(paths)) {
      const spec = specForDocumentPath(path);
      expect(spec?.kind, path).toBe(kind);
      expect(typeof spec?.diff, `${kind} declares a diff but the spec does not carry one`).toBe(
        "function"
      );
    }
  });

  /**
   * The same forwarding question for D7's `merge3`, asked at the registry rather than at the
   * definition, because this is where the merge pipeline will reach for it: a path off a
   * conflict event, resolved to a spec, asked whether it can merge one entry at a time.
   *
   * It fails worse than `diff` did. A dropped `diff` costs a lesser change list; a dropped
   * `merge3` silently sends every conflict back to the first tier, where the only move is to
   * take one side of the whole file - and the author is never told the per-change resolution
   * they can see in the interface was not the one that ran.
   */
  it("keeps the three-way merge the localization and asset specs declare", () => {
    for (const [kind, path] of Object.entries({
      localization: "editor/localization/zh-CN.json",
      "assets-metadata": "assets/assets.metadata.image.json"
    })) {
      const spec = specForDocumentPath(path);
      expect(spec?.kind, path).toBe(kind);
      expect(typeof spec?.merge3, `${kind} declares merge3 but the spec does not carry one`).toBe(
        "function"
      );
    }
  });

  it("answers undefined for a path no spec claims, rather than throwing", () => {
    expect(specForDocumentPath("assets/content/ab/cd/portrait.png")).toBeUndefined();
    // An absolute path is what the backend reports on some surfaces (docs §4.16); the
    // registry rejects it loudly and the engine has to swallow that, or one odd entry
    // in a tree would fail the whole revision's diff.
    expect(specForDocumentPath("D:/projects/demo/editor/audio-tracks.json")).toBeUndefined();
  });

  it("is reachable from the main entry point's static import graph", async () => {
    const result = await esbuild.build({
      entryPoints: [MAIN_ENTRY],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "cjs",
      target: ["node18"],
      external: EXTERNAL,
      tsconfig: path.join(ROOT, "src", "main", "tsconfig.json"),
      logLevel: "silent"
    });

    // The same static-only walk `pluggability.test.ts` performs, duplicated rather than
    // shared because a test importing another test file runs that file's suite twice.
    const inputs = result.metafile.inputs;
    const entry = Object.keys(inputs).find((file) => file.endsWith("src/main/index.ts"));
    expect(entry, "main entry not found in the bundle metafile").toBeDefined();

    const reachable = new Set<string>();
    const queue = [entry as string];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reachable.has(file)) continue;
      reachable.add(file);
      for (const edge of inputs[file]?.imports ?? []) {
        // A dynamic import does not run at startup, so registration behind one would
        // depend on whether anything had opened a project yet.
        if (edge.kind === "dynamic-import") continue;
        if (edge.external || !inputs[edge.path]) continue;
        queue.push(edge.path);
      }
    }

    expect(
      [...reachable].some((file) => file.endsWith("shared/documents/specs/index.ts")),
      "the main process never imports @shared/documents/specs, so its registry is empty" +
        " and every semantic diff degrades silently"
    ).toBe(true);
  }, 120_000);
});
