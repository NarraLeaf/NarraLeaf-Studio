import { describe, expect, it } from "vitest";
import {
  KNOWN_PUPPET_RUNTIME_IDS,
  customPuppetRuntimeDocsUrl,
  isKnownPuppetRuntimeId,
  knownPuppetRuntime,
  knownPuppetRuntimeFor,
  listKnownPuppetRuntimes,
  puppetRuntimeDocsUrl
} from "./puppetRuntimes";

describe("known puppet runtimes", () => {
  it("answers to its own ids and to nothing else", () => {
    for (const id of KNOWN_PUPPET_RUNTIME_IDS) {
      expect(isKnownPuppetRuntimeId(id)).toBe(true);
      expect(knownPuppetRuntimeFor(id)).toBe(knownPuppetRuntime(id));
    }
    // An unrecognised name is the normal case for a runtime the author wrote, not an error.
    for (const value of ["", "puppet", "Live2D", "spine2d", null, undefined]) {
      expect(isKnownPuppetRuntimeId(value)).toBe(false);
      expect(knownPuppetRuntimeFor(value as string | null | undefined)).toBeNull();
    }
  });

  it("gives each runtime a distinct backend directory", () => {
    const backends = listKnownPuppetRuntimes().map((runtime) => runtime.backend);
    expect(backends).toEqual([...new Set(backends)]);
    for (const runtime of listKnownPuppetRuntimes()) {
      // The folder name is also the id, which is what lets an appearance kind, a directory
      // under runtimes/puppet/ and an engine backend name all be looked up as one string.
      expect(runtime.backend).toBe(runtime.id);
      // A path segment, so nothing that could climb out of runtimes/puppet/.
      expect(runtime.backend).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("can install every runtime it names, by some route", () => {
    for (const runtime of listKnownPuppetRuntimes()) {
      expect(runtime.methods.length).toBeGreaterThan(0);
      expect(runtime.productName.trim()).not.toBe("");
      expect(runtime.vendorUrl).toMatch(/^https:\/\//);
      // A site-root path, not a URL: the locale goes in the middle of it.
      expect(runtime.docsPath).toMatch(/^\/docs\/studio\/model-runtimes\//);
    }
  });

  /**
   * The docs site hides its default locale, so English is `/docs/…` and everything else is
   * `/<locale>/docs/…`. Getting that backwards produces a 404 rather than an error, and a dead link
   * in the one dialog whose whole job is to send the author somewhere useful.
   */
  describe("documentation links", () => {
    it("puts a non-default locale in front of the path and the default one nowhere", () => {
      const live2d = knownPuppetRuntime("live2d");
      expect(puppetRuntimeDocsUrl(live2d, "en")).toBe(
        "https://www.narraleaf.com/docs/studio/model-runtimes/live2d"
      );
      expect(puppetRuntimeDocsUrl(live2d, "zh")).toBe(
        "https://www.narraleaf.com/zh/docs/studio/model-runtimes/live2d"
      );
      expect(customPuppetRuntimeDocsUrl("zh")).toBe(
        "https://www.narraleaf.com/zh/docs/studio/model-runtimes/custom"
      );
    });

    it("falls back to English for a locale the docs site does not publish", () => {
      // Studio's locale list is open - a plugin can register one (see shared/i18n/locales.ts) -
      // and prefixing an unpublished locale would link to nothing.
      for (const locale of ["ja", "de", "zh-TW", "", "en-GB"]) {
        expect(puppetRuntimeDocsUrl(knownPuppetRuntime("spine"), locale)).toBe(
          "https://www.narraleaf.com/docs/studio/model-runtimes/spine"
        );
      }
    });

    it("gives every named runtime its own page", () => {
      const urls = listKnownPuppetRuntimes().map((runtime) => puppetRuntimeDocsUrl(runtime, "en"));
      expect(urls).toEqual([...new Set(urls)]);
      expect(urls).not.toContain(customPuppetRuntimeDocsUrl("en"));
    });
  });

  /**
   * Not a style check. Studio holds no Spine Editor licence, and integrating a Spine runtime
   * requires the integrator to hold one (Editor License Agreement 2.1(b)) — so Studio ships no
   * Spine glue to build from, and `sdk-zip` (which means "Studio builds the adapter here") must not
   * appear against it. If that licence is ever bought, this test is the thing that has to change
   * first, deliberately.
   */
  it("only offers to build an adapter for a runtime Studio may integrate with", () => {
    expect(knownPuppetRuntime("spine").methods).toEqual(["prebuilt"]);
    expect(knownPuppetRuntime("live2d").methods).toContain("sdk-zip");
  });
});
