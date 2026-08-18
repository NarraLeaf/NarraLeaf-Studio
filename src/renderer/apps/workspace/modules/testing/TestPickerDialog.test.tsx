import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TEST_CATEGORY_ORDER,
  type RegisteredTest,
  type TestCategory,
  type TestDefinition
} from "@/lib/testing/types";
import { TestPickerContent } from "./TestPickerDialog";
import { TEST_CATEGORY_LABEL_KEYS } from "./testModel";

/**
 * Guards the two things about the picker that cannot be seen from its own file: that every category
 * a test can claim is one the list can actually draw, and that a row says the four things an author
 * decides on (what it is called, whether a window is about to open, whose it is, what it does).
 *
 * Rendered with `renderToStaticMarkup`, so effects never run - which is also the state an author
 * first sees, since the picker asks the registry once and then just draws.
 */

/**
 * Every category a test can be filed under. Written as a total record so the union growing breaks
 * this file at compile time, and the assertions below then fail until the order list and the label
 * table grow with it - a category with no row in `TEST_CATEGORY_ORDER` is a group of tests that
 * renders nowhere, and one with no entry in the label table is a heading that reads as a raw key.
 */
const EVERY_CATEGORY: Record<TestCategory, true> = {
  integrity: true,
  runtime: true,
  compatibility: true,
  custom: true
};

const noop = () => undefined;
const alwaysAvailable = () => ({ available: true }) as const;

function definition(
  overrides: Partial<TestDefinition> & Pick<TestDefinition, "id">
): TestDefinition {
  return {
    title: { text: `Title of ${overrides.id}` },
    presentation: "headless",
    run: () => ({ status: "passed" }),
    ...overrides
  };
}

function registered(
  overrides: Partial<TestDefinition> & Pick<TestDefinition, "id">,
  ownerPluginId?: string
): RegisteredTest {
  return { definition: definition(overrides), ownerPluginId };
}

describe("the picker's categories", () => {
  it("draws a group for every category a test can claim", () => {
    expect([...TEST_CATEGORY_ORDER].sort()).toEqual(Object.keys(EVERY_CATEGORY).sort());
  });

  it("labels every one of them", () => {
    expect(Object.keys(TEST_CATEGORY_LABEL_KEYS).sort()).toEqual(
      Object.keys(EVERY_CATEGORY).sort()
    );
  });

  it("heads each populated group, and only those", () => {
    const markup = renderToStaticMarkup(
      <TestPickerContent
        tests={[
          registered({ id: "narraleaf-studio:a", category: "integrity" }),
          registered({ id: "acme:b", category: "custom" })
        ]}
        getAvailability={alwaysAvailable}
        onStart={noop}
        onCancel={noop}
      />
    );

    expect(markup).toContain("Integrity");
    expect(markup).toContain("Custom");
    // Nothing claimed these, so they must not put an empty heading on the list.
    expect(markup).not.toContain("Runtime");
    expect(markup).not.toContain("Compatibility");
  });

  it("files a test that claims no category under custom", () => {
    const markup = renderToStaticMarkup(
      <TestPickerContent
        tests={[registered({ id: "acme:uncategorised" })]}
        getAvailability={alwaysAvailable}
        onStart={noop}
        onCancel={noop}
      />
    );

    expect(markup).toContain("Custom");
  });
});

describe("a picker row", () => {
  it("badges what the test will put on screen, and says whose it is", () => {
    const markup = renderToStaticMarkup(
      <TestPickerContent
        tests={[
          registered({
            id: "narraleaf-studio:project-diagnostics",
            category: "integrity",
            title: { text: "Project diagnostics" },
            description: { text: "Every project lint rule, run as one check" }
          }),
          registered(
            {
              id: "acme.pack:route-walk",
              category: "runtime",
              title: { text: "Route walk" },
              presentation: "windowed"
            },
            "acme.pack"
          )
        ]}
        getAvailability={alwaysAvailable}
        onStart={noop}
        onCancel={noop}
      />
    );

    expect(markup).toContain("Project diagnostics");
    expect(markup).toContain("Every project lint rule, run as one check");
    expect(markup).toContain("Headless");
    expect(markup).toContain("Route walk");
    expect(markup).toContain("Windowed");
    // A plugin's test has to be visibly a plugin's test.
    expect(markup).toContain("acme.pack");
  });

  it("greys an unavailable row and shows its reason instead of its description", () => {
    const markup = renderToStaticMarkup(
      <TestPickerContent
        tests={[
          registered({
            id: "narraleaf-studio:windowed",
            category: "runtime",
            title: { text: "Needs a window" },
            description: { text: "the description" },
            presentation: "windowed"
          })
        ]}
        getAvailability={() => ({ available: false, reason: { key: "test.reason.frozen" } })}
        onStart={noop}
        onCancel={noop}
      />
    );

    expect(markup).toContain("Not available while the workspace is frozen");
    expect(markup).toContain("disabled");
    // The reason takes the description's line: on a row that cannot be run, why it cannot is
    // the only thing the author is deciding on.
    expect(markup).not.toContain("the description");
    // It stays listed and named, though - a test that vanished would read as one never installed.
    expect(markup).toContain("Needs a window");
  });

  it("says so rather than showing an empty list when nothing is registered", () => {
    const markup = renderToStaticMarkup(
      <TestPickerContent
        tests={[]}
        getAvailability={alwaysAvailable}
        onStart={noop}
        onCancel={noop}
      />
    );

    expect(markup).toContain("No tests are registered");
  });
});

// The picker reads the registry through the workspace context, never the app bridge, which does not
// exist outside Electron. Effects do not run under static rendering, so this only has to be
// importable - and if a render ever does reach IPC, it fails here loudly instead of silently.
vi.mock("@/lib/app/bridge", () => ({
  getInterface: () => {
    throw new Error("the test picker must not reach the bridge while rendering");
  }
}));
