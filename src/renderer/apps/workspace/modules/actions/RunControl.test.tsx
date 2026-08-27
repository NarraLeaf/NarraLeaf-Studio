// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions as enActions } from "@shared/i18n/catalog/en/actions";
import { RunControl } from "./RunControl";

/**
 * What the Run split-button offers while the workspace is frozen.
 *
 * The thing worth pinning is not the markup but the agreement between the two sides. Main starts
 * every one of these and refuses them on its own account, and there is one kind of freeze it does
 * not refuse - so a row greyed out here under that kind would be a dead control with nothing on
 * screen to explain it, while the process behind it would have said yes. The other four kinds must
 * still switch the rows off: a build of a revision the author is only reading is exactly what that
 * refusal exists for.
 *
 * Rendered with `renderToStaticMarkup`, following `BuildDialogSections.test.tsx`: no effect runs, so
 * the control needs no services standing behind it, and what is checked is the shape it takes from
 * the freeze alone. The dropdown is forced open, because Production Build, Export Patch and the mode
 * rows all live inside it.
 */

/**
 * The one value every affordance in the control reads.
 *
 * `useWorkspaceOperationsFrozen` is true for the four kinds that refuse and false for the fifth and
 * for a writable workspace - which kind produced it is that hook's business, and the predicate
 * behind it has its own suite (`@shared/types/workspaceFreeze`).
 */
let operationsFrozen = false;
vi.mock("../../hooks/useWorkspaceFrozen", () => ({
    useWorkspaceOperationsFrozen: () => operationsFrozen,
    // Read by `useFreezeUnavailableReason`, which picks the sentence a greyed row shows. Null is
    // "no freeze", which is the right answer for a test that sets `operationsFrozen` by hand: the
    // ordinary sentence is what a manual freeze and a revision both show.
    useWorkspaceFreeze: () => null,
}));

vi.mock("../../context", () => ({
    useWorkspace: () => ({ workspace: null, context: null }),
}));

// The run chords register in effects and render nothing; their `when` predicates read the same flag
// as the rows below.
vi.mock("../../hooks", () => ({
    useKeybinding: () => undefined,
    useKeybindings: () => undefined,
}));

// Forced open: every row under test is inside the dropdown.
vi.mock("../../components/ui/titleBarMenus", () => ({
    useTitleBarMenu: () => ({
        ref: { current: null },
        open: true,
        setOpen: () => undefined,
        close: () => undefined,
        toggle: () => undefined,
        triggerProps: {},
    }),
}));

vi.mock("../../hooks/useShortcutLabels", () => ({
    useShortcutLabels: () => ({
        forAction: () => undefined,
        forBinding: () => undefined,
        forMenuItem: () => undefined,
    }),
}));

/** Every row of the open dropdown, by its label, with whether the control is switched off. */
function menuRows(): Map<string, boolean> {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<RunControl />);
    const rows = new Map<string, boolean>();
    for (const element of host.querySelectorAll("[role^=\"menuitem\"]")) {
        // `:disabled` rather than the `disabled` property: a control switched off by an ancestor
        // `<fieldset disabled>` reports `disabled === false` and would read as live.
        rows.set((element.textContent ?? "").trim(), element.matches(":disabled"));
    }
    return rows;
}

function isOff(rows: Map<string, boolean>, label: string): boolean {
    const row = rows.get(label);
    if (row === undefined) {
        throw new Error(`No row labelled "${label}" - the control's rows have moved. Saw: ${[...rows.keys()].join(" | ")}`);
    }
    return row;
}

beforeEach(() => {
    operationsFrozen = false;
});

describe("RunControl while frozen", () => {
    it("offers every run and build row on a writable workspace", () => {
        const rows = menuRows();
        expect(isOff(rows, enActions.run.productionBuild)).toBe(false);
        expect(isOff(rows, enActions.run.exportPatch)).toBe(false);
        expect(isOff(rows, enActions.run.preview)).toBe(false);
        expect(isOff(rows, enActions.run.devMode)).toBe(false);
    });

    it("switches Production Build, Export Patch and Preview off under a freeze that refuses them", () => {
        operationsFrozen = true;
        const rows = menuRows();

        expect(isOff(rows, enActions.run.productionBuild)).toBe(true);
        expect(isOff(rows, enActions.run.exportPatch)).toBe(true);
        expect(isOff(rows, enActions.run.preview)).toBe(true);
        // Dev Mode runs what is on disk, which is what a frozen workspace is showing.
        expect(isOff(rows, enActions.run.devMode)).toBe(false);
    });

    it("leaves them all live under a freeze main does not refuse", () => {
        // The live-session case: the workspace IS frozen, and the hook answers false because what a
        // session shows every participant is the working tree - so what these rows produce is what
        // the author is looking at, and there is nothing for the refusal to protect.
        operationsFrozen = false;
        const rows = menuRows();

        expect(isOff(rows, enActions.run.productionBuild)).toBe(false);
        expect(isOff(rows, enActions.run.exportPatch)).toBe(false);
        expect(isOff(rows, enActions.run.preview)).toBe(false);
    });
});
