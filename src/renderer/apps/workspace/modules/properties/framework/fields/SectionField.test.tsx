// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHelpOpener, type HelpRequest } from "@/lib/help/helpController";
import type { HelpTopicId } from "@/lib/help";
import type { SectionFieldDefinition } from "../types";
import { SectionField } from "./SectionField";

/**
 * What a section's help topic puts on the inspector: `F1` from anywhere inside the section, and a `?`
 * in its header that opens the topic without folding the section it sits on.
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

vi.mock("../../../../hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFrozen: () => false,
    useWorkspaceFreeze: () => null,
}));

afterEach(cleanup);

function Inside() {
    return <p data-testid="inside">inside</p>;
}

function section(helpTopic?: HelpTopicId): SectionFieldDefinition<Record<string, never>> {
    return {
        id: "navigation",
        type: "section",
        title: "Navigation",
        collapsible: true,
        helpTopic,
        fields: [{ id: "navigation.inside", type: "custom", component: Inside }],
    } as SectionFieldDefinition<Record<string, never>>;
}

describe("SectionField", () => {
    it("tags the section with its topic and opens it from the header's ?", () => {
        const requests: HelpRequest[] = [];
        const unregister = registerHelpOpener(request => requests.push(request));
        try {
            const { container, getByRole, queryByTestId } = render(
                <SectionField field={section("focusNavigationSettings")} data={{}} onSaving={() => {}} />,
            );
            expect(container.querySelector("[data-help-topic]")?.getAttribute("data-help-topic"))
                .toBe("focusNavigationSettings");

            fireEvent.click(getByRole("button", { name: "help.ui.openTopic" }));
            expect(requests.map(request => request.topicId)).toEqual(["focusNavigationSettings"]);
            // The click stays with the `?`: the section is still open.
            expect(queryByTestId("inside")).not.toBeNull();
        } finally {
            unregister();
        }
    });

    it("draws neither the attribute nor the ? for a section with no topic", () => {
        const { container, queryByRole } = render(<SectionField field={section()} data={{}} onSaving={() => {}} />);
        expect(container.querySelector("[data-help-topic]")).toBeNull();
        expect(queryByRole("button", { name: "help.ui.openTopic" })).toBeNull();
    });
});
