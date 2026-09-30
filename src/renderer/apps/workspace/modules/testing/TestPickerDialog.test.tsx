// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestParameters } from "@/lib/testing/parameters";
import type { TestParameterMemory } from "@/lib/testing/parameterCache";
import {
    TEST_CATEGORY_ORDER,
    type RegisteredTest,
    type TestAvailabilityContext,
    type TestCategory,
    type TestDefinition,
    type TestId,
    type TestParameterValues,
} from "@/lib/testing/types";
import { TestPickerContent } from "./TestPickerDialog";
import { TEST_CATEGORY_LABEL_KEYS } from "./testModel";

/**
 * Guards the two things about the picker that cannot be seen from its own file: that every category
 * a test can claim is one the list can actually draw, and that a row says the four things an author
 * decides on (what it is called, whether a window is about to open, whose it is, what it does).
 *
 * The list half is rendered with `renderToStaticMarkup`, so effects never run - which is also the
 * state an author first sees, since the picker asks the registry once and then just draws. The
 * parameters half cannot be: a parameter only appears once a test is selected, and selecting one is
 * a click. Those tests mount for real and drive the controls.
 */

afterEach(cleanup);

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
    custom: true,
};

const noop = () => undefined;
const alwaysAvailable = () => ({ available: true }) as const;

function definition(overrides: Partial<TestDefinition> & Pick<TestDefinition, "id">): TestDefinition {
    return {
        title: { text: `Title of ${overrides.id}` },
        presentation: "headless",
        run: () => ({ status: "passed" }),
        ...overrides,
    };
}

function registered(overrides: Partial<TestDefinition> & Pick<TestDefinition, "id">, ownerPluginId?: string): RegisteredTest {
    return { definition: definition(overrides), ownerPluginId };
}

describe("the picker's categories", () => {
    it("draws a group for every category a test can claim", () => {
        expect([...TEST_CATEGORY_ORDER].sort()).toEqual(Object.keys(EVERY_CATEGORY).sort());
    });

    it("labels every one of them", () => {
        expect(Object.keys(TEST_CATEGORY_LABEL_KEYS).sort()).toEqual(Object.keys(EVERY_CATEGORY).sort());
    });

    it("heads each populated group, and only those", () => {
        const markup = renderToStaticMarkup(
            <TestPickerContent
                tests={[
                    registered({ id: "narraleaf-studio:a", category: "integrity" }),
                    registered({ id: "acme:b", category: "custom" }),
                ]}
                getAvailability={alwaysAvailable}
                onStart={noop}
                onCancel={noop}
            />,
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
            />,
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
                        description: { text: "Every project lint rule, run as one check" },
                    }),
                    registered(
                        {
                            id: "acme.pack:route-walk",
                            category: "runtime",
                            title: { text: "Route walk" },
                            presentation: "windowed",
                        },
                        "acme.pack",
                    ),
                ]}
                getAvailability={alwaysAvailable}
                onStart={noop}
                onCancel={noop}
            />,
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
                        presentation: "windowed",
                    }),
                ]}
                getAvailability={() => ({ available: false, reason: { key: "test.reason.frozen" } })}
                onStart={noop}
                onCancel={noop}
            />,
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
            <TestPickerContent tests={[]} getAvailability={alwaysAvailable} onStart={noop} onCancel={noop} />,
        );

        expect(markup).toContain("No tests are registered");
    });
});

/**
 * What the author is asked before Start.
 *
 * The property under test throughout is that **what the picker shows and what it starts the run
 * with are the same thing**. A dropdown that displays one ending and hands over another would be
 * the one failure a test pipeline cannot survive, and every case below is a way that could happen:
 * a remembered value, a remembered value whose option is gone, a value the author just changed.
 */
describe("the picker's parameters", () => {
    const CONTEXT: TestAvailabilityContext = { projectPath: "D:/project", frozen: false, distrusted: false };

    const WALK: TestDefinition = definition({
        id: "acme.pack:walk",
        title: { text: "Walk to an ending" },
        category: "runtime",
        parameters: [
            {
                id: "ending",
                kind: "select",
                label: { text: "Ending" },
                description: { text: "Where the walk stops" },
                defaultValue: "good",
                options: () => [
                    { value: "good", label: { text: "Good end" } },
                    { value: "true", label: { text: "True end" } },
                ],
            },
            { id: "skipRead", kind: "boolean", label: { text: "Skip read text" }, defaultValue: true },
        ],
    });
    const PLAIN: TestDefinition = definition({ id: "acme.pack:plain", title: { text: "Plain check" } });

    function mount(options: {
        remembered?: TestParameterMemory;
        available?: boolean;
        started: (testId: TestId, parameters: TestParameterValues) => void;
    }) {
        render(
            <TestPickerContent
                tests={[{ definition: WALK }, { definition: PLAIN }]}
                getAvailability={() =>
                    options.available === false
                        ? { available: false, reason: { key: "test.reason.frozen" } }
                        : { available: true }
                }
                listParameters={id =>
                    resolveTestParameters(id === WALK.id ? WALK : PLAIN, CONTEXT)
                }
                rememberedParameters={options.remembered}
                onStart={options.started}
                onCancel={noop}
            />,
        );
    }

    const select = (title: string) => fireEvent.click(screen.getByRole("option", { name: title }));
    const start = () => fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const endingTrigger = () => screen.getByRole("button", { name: "Ending" });

    it("draws a control per declaration once its test is selected, and none before", () => {
        const started = vi.fn();
        mount({ started });

        expect(screen.queryByRole("group", { name: "Parameters" })).toBeNull();

        select("Walk to an ending");

        expect(screen.getByRole("group", { name: "Parameters" })).toBeTruthy();
        expect(endingTrigger().textContent).toContain("Good end");
        expect(screen.getByRole("switch", { name: "Skip read text" }).getAttribute("aria-checked")).toBe("true");
        // The description is the parameter's own line, not a sentence about the control.
        expect(screen.getByText("Where the walk stops")).toBeTruthy();
    });

    it("leaves a test that declares nothing exactly as it was", () => {
        const started = vi.fn();
        mount({ started });

        select("Plain check");

        expect(screen.queryByRole("group", { name: "Parameters" })).toBeNull();
        start();
        expect(started).toHaveBeenCalledWith("acme.pack:plain", {});
    });

    it("opens on the value this test was last run with", () => {
        const started = vi.fn();
        mount({ started, remembered: { "acme.pack:walk": { ending: "true", skipRead: false } } });

        select("Walk to an ending");

        expect(endingTrigger().textContent).toContain("True end");
        expect(screen.getByRole("switch", { name: "Skip read text" }).getAttribute("aria-checked")).toBe("false");
        start();
        expect(started).toHaveBeenCalledWith("acme.pack:walk", { ending: "true", skipRead: false });
    });

    it("falls back to the default when the remembered ending has been deleted", () => {
        // The author removed that ending between one run and the next. The control must not be left
        // pointing at nothing, and the deleted id must not reach the run.
        const started = vi.fn();
        mount({ started, remembered: { "acme.pack:walk": { ending: "the-one-they-deleted" } } });

        select("Walk to an ending");

        expect(endingTrigger().textContent).toContain("Good end");
        start();
        expect(started).toHaveBeenCalledWith("acme.pack:walk", { ending: "good", skipRead: true });
    });

    it("starts with what the author changed it to", () => {
        const started = vi.fn();
        mount({ started });

        select("Walk to an ending");
        fireEvent.click(endingTrigger());
        fireEvent.click(screen.getByRole("button", { name: "True end" }));
        fireEvent.click(screen.getByRole("switch", { name: "Skip read text" }));
        start();

        expect(endingTrigger().textContent).toContain("True end");
        expect(started).toHaveBeenCalledWith("acme.pack:walk", { ending: "true", skipRead: false });
    });

    it("refuses to select an unavailable test at all, so nothing offers to run it", () => {
        // An unavailable row stays listed and says why (see above), and it declines the click - so a
        // test the host would refuse never reaches the point of asking the author for values. This
        // is what the host's empty-option-list gate produces: the reason is on the row, and there is
        // no dead dropdown underneath it.
        const started = vi.fn();
        mount({ started, available: false });

        select("Walk to an ending");

        expect(screen.getByRole("option", { name: "Walk to an ending" })).toBeTruthy();
        expect(screen.queryByRole("group", { name: "Parameters" })).toBeNull();
        start();
        expect(started).not.toHaveBeenCalled();
    });
});

// The picker reads the registry through the workspace context, never the app bridge, which does not
// exist outside Electron. Effects do not run under static rendering, so this only has to be
// importable - and if a render ever does reach IPC, it fails here loudly instead of silently.
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => {
        throw new Error("the test picker must not reach the bridge while rendering");
    },
}));
