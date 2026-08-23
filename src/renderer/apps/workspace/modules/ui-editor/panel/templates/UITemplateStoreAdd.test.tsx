// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import { UITemplateCard } from "./UITemplateCard";
import { UITemplateDetail } from "./UITemplateDetail";

/**
 * Add is the store's only write, so it is the only control a freeze switches off.
 *
 * The button that opens the store is greyed while frozen already, and that is not the case this
 * covers: a freeze arrives while the workspace is running - a collaborator opens a session, the
 * author steps back to a past revision - and the store already on screen kept its Add buttons.
 * Pressing one imported the template's assets and rewrote the interface document, all of it refused
 * at the write boundary, leaving a tab open on a page that was never written.
 *
 * Browsing is untouched in both cases: the shelf, the search and the previews read a remote registry
 * and nothing of the author's.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join(",")})` : key,
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

const ENTRY: UITemplateRegistryEntry = {
    id: "narraleaf.save-load",
    name: "Save & Load",
    version: "1.0.0",
    description: "A save and load page.",
    publisher: "NarraLeaf",
    categories: [],
    path: "templates/narraleaf.save-load",
    document: "document.json",
    graphs: "graphs.json",
    surface: { kind: "appSurface" },
    assets: [],
};

/** Unavailable rather than ready: a preview needs the runtime bridge, and Add is what is under test. */
const PREVIEW = { status: "unavailable" } as const;

function addButton(): HTMLElement {
    return screen.getByText("uiEditor.templateStore.add").closest("button")!;
}

afterEach(cleanup);

describe("the template store's Add control", () => {
    it("is live on a writable workspace", () => {
        render(
            <UITemplateCard
                entry={ENTRY}
                preview={PREVIEW}
                runtimeBridge={null}
                placementLabel="Page"
                busy={false}
                onAdd={() => {}}
                onOpenDetail={() => {}}
            />,
        );

        expect(addButton().matches(":disabled")).toBe(false);
    });

    it("is switched off on a card while the workspace is frozen, and says why", () => {
        render(
            <UITemplateCard
                entry={ENTRY}
                preview={PREVIEW}
                runtimeBridge={null}
                placementLabel="Page"
                addDisabledReason="frozen.reason"
                busy={false}
                onAdd={() => {}}
                onOpenDetail={() => {}}
            />,
        );

        const add = addButton();
        expect(add.matches(":disabled")).toBe(true);
        expect(add.getAttribute("data-tip")).toBe("frozen.reason");
    });

    it("is switched off in the detail view too, where the second Add lives", () => {
        render(
            <UITemplateDetail
                entry={ENTRY}
                preview={PREVIEW}
                runtimeBridge={null}
                placementLabel="Page"
                addDisabledReason="frozen.reason"
                busy={false}
                onAdd={() => {}}
                onBack={() => {}}
            />,
        );

        expect(addButton().matches(":disabled")).toBe(true);
    });

    it("lets the template's own reason keep the label, because that one names the template", () => {
        render(
            <UITemplateCard
                entry={ENTRY}
                preview={PREVIEW}
                runtimeBridge={null}
                placementLabel="Page"
                blockedReason="uiEditor.templateStore.slotTaken"
                addDisabledReason="frozen.reason"
                busy={false}
                onAdd={() => {}}
                onOpenDetail={() => {}}
            />,
        );

        const add = screen.getByText("uiEditor.templateStore.slotOccupied").closest("button")!;
        expect(add.matches(":disabled")).toBe(true);
        expect(add.getAttribute("data-tip")).toBe("uiEditor.templateStore.slotTaken");
    });
});
