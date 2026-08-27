// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "../types";
import { FieldRenderer } from "./FieldRenderer";

/**
 * What a field declared read-only renders as inside a workspace nobody has frozen.
 *
 * The two ways a field stands down are not interchangeable. A freeze is a state of the project and
 * arrives through the guard; `readOnly` on the definition is a state of the view, and a schema that
 * sets it - one half of a version comparison is built that way - has to switch every control off on
 * its own, with no freeze and no inspection context behind it.
 *
 * The field type below hands its rendering to the caller, so there is nothing for the framework to
 * thread the flag into and the clamp is the only thing that can switch it off. That is the case a
 * naive check misses: the control carries no `disabled` attribute of its own, and only the browser's
 * `:disabled` state - inherited from the ancestor `<fieldset disabled>` - says it cannot be operated.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

// Nothing is frozen and nothing claimed: everything switched off below is switched off by the flag.
vi.mock("../../../../hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFrozen: () => false,
    useWorkspaceFreeze: () => null,
}));

afterEach(cleanup);

function inlineRow(readOnly: boolean): FieldDefinition<Record<string, never>> {
    return {
        id: "row",
        type: "inlineRow",
        label: "Row",
        readOnly,
        items: [
            {
                id: "row.value",
                render: () => <input aria-label="value" defaultValue="1" />,
            },
        ],
    } as unknown as FieldDefinition<Record<string, never>>;
}

describe("FieldRenderer", () => {
    it("switches off a control a read-only field handed to its caller", () => {
        render(<FieldRenderer field={inlineRow(true)} data={{}} onSaving={() => {}} />);
        const input = window.document.querySelector<HTMLInputElement>("input[aria-label='value']");
        expect(input).toBeTruthy();
        expect(input!.matches(":disabled")).toBe(true);
    });

    it("leaves the same control alone when the field is not read-only", () => {
        render(<FieldRenderer field={inlineRow(false)} data={{}} onSaving={() => {}} />);
        const input = window.document.querySelector<HTMLInputElement>("input[aria-label='value']");
        expect(input).toBeTruthy();
        expect(input!.matches(":disabled")).toBe(false);
    });
});
