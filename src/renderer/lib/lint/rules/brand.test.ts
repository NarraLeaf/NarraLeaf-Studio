import { afterEach, describe, expect, it } from "vitest";
import { BrandPalette, setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { collectBrandLinkReferences } from "@shared/brand/brandReferences";
import { BUILTIN_BRAND_COLORS, type BrandColor } from "@shared/types/brand";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { createTestLintContext } from "../testContext";
import { BRAND_LINT_RULES, classifyBrandLink, collectBrokenBrandLinks } from "./brand";

/**
 * `brand/broken-link`.
 *
 * The classifier is tested on its own because the three reasons are the whole point of the rule -
 * "this points at nothing" and "this points at itself" send an author to different places - and
 * through the rule they would all look alike from the outside.
 */

const RULE = BRAND_LINT_RULES[0]!;

const color = (id: string, value: string): BrandColor => ({ id, value });

/** A document whose one button paints from `nlbrand:<link>`. */
function documentLinking(link: string): UIDocument {
  return {
    surfaces: [{ id: "s1", name: "Main Menu", rootElementId: "root" }],
    elements: {
      root: { id: "root", type: "nl.root", childrenIds: ["start"] },
      start: {
        id: "start",
        type: "nl.button",
        name: "Start",
        childrenIds: [],
        style: { backgroundColor: `nlbrand:${link}` }
      }
    }
  } as unknown as UIDocument;
}

afterEach(() => {
  // The active palette is module-level state two hosts push into; a test that left its own palette
  // published would decide what the next one resolves.
  setActiveBrandPalette(BUILTIN_BRAND_COLORS);
});

describe("classifyBrandLink", () => {
  it("says nothing about a link that paints", () => {
    const palette = new BrandPalette(BUILTIN_BRAND_COLORS);
    expect(classifyBrandLink(palette, "primary")).toBeNull();
    expect(classifyBrandLink(palette, "button.primary")).toBeNull();
  });

  it("calls an id the palette does not have missing", () => {
    expect(classifyBrandLink(new BrandPalette(BUILTIN_BRAND_COLORS), "nope")).toEqual({
      kind: "missing"
    });
  });

  it("calls a ring a ring", () => {
    const palette = new BrandPalette([color("a", "nlbrand:b"), color("b", "nlbrand:a")]);
    expect(classifyBrandLink(palette, "a")).toEqual({ kind: "cycle" });
  });

  it("names the entry the chain runs out at, rather than calling it a ring", () => {
    // The ordinary way a project gets here: an author deletes their own colour while a control
    // slot still links to it, so what a widget points at exists and what *it* points at does not.
    const palette = new BrandPalette([color("button.primary", "nlbrand:mine")]);
    expect(classifyBrandLink(palette, "button.primary")).toEqual({
      kind: "chain",
      missingId: "mine"
    });
  });
});

describe("collectBrokenBrandLinks", () => {
  it("reports one failure per site, not one per colour", () => {
    const references = collectBrandLinkReferences({
      uidoc: {
        elements: {
          a: { id: "a", type: "nl.button", style: { backgroundColor: "nlbrand:nope" } },
          b: { id: "b", type: "nl.button", style: { backgroundColor: "nlbrand:nope" } }
        }
      }
    });
    const failures = collectBrokenBrandLinks(references, new BrandPalette(BUILTIN_BRAND_COLORS));

    expect(failures.map((failure) => failure.reference.location.elementId)).toEqual(["a", "b"]);
  });
});

describe("brand/broken-link", () => {
  it("is a warning by default", () => {
    // Not an error: the widget draws its own fallback and the game runs, so this must not be a
    // thing that stops a build.
    expect(RULE.defaultSeverity).toBe("warning");
  });

  it("reports a link the palette has no entry for", async () => {
    const findings = await RULE.run(
      createTestLintContext({ uiDocument: documentLinking("nope") }),
      {}
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "brand/broken-link",
      messageKey: "lint.rule.brandBrokenLink.message",
      messageParams: { where: "Main Menu › Start › style.backgroundColor", color: "nope" },
      location: { kind: "project" },
      // The report row opens the surface the broken widget is on.
      target: { kind: "uiSurface", surfaceId: "s1" }
    });
  });

  it("reports a link into a ring", async () => {
    setActiveBrandPalette([color("a", "nlbrand:b"), color("b", "nlbrand:a")]);
    const findings = await RULE.run(
      createTestLintContext({ uiDocument: documentLinking("a") }),
      {}
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      messageKey: "lint.rule.brandBrokenLink.messageCycle",
      messageParams: { color: "a" }
    });
  });

  it("names the missing entry when the chain runs out further down", async () => {
    setActiveBrandPalette([color("button.primary", "nlbrand:mine")]);
    const findings = await RULE.run(
      createTestLintContext({ uiDocument: documentLinking("button.primary") }),
      {}
    );

    expect(findings[0]).toMatchObject({
      messageKey: "lint.rule.brandBrokenLink.messageChain",
      messageParams: { color: "button.primary", missing: "mine" }
    });
  });

  it("says nothing about a link that resolves", async () => {
    const findings = await RULE.run(
      createTestLintContext({ uiDocument: documentLinking("button.primary") }),
      {}
    );
    expect(findings).toEqual([]);
  });

  it("says nothing about a project with no links at all", async () => {
    expect(await RULE.run(createTestLintContext(), {})).toEqual([]);
    expect(
      await RULE.run(
        createTestLintContext({
          uiDocument: {
            elements: { a: { id: "a", type: "nl.button", style: { backgroundColor: "#40A8C4" } } }
          } as unknown as UIDocument
        }),
        {}
      )
    ).toEqual([]);
  });
});
