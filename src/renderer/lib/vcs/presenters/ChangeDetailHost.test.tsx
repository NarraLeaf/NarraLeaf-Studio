// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChange, DocumentDiffEntry, DocumentDiffTier } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import { registerChangePresenter } from "./registry";

/**
 * **One presenter is mounted, and one only.**
 *
 * The surface this replaced was every changed document's list stacked in one scroller. The way back
 * to it is not a redesign, it is one `map` in the detail pane - so what is pinned here is the count
 * of mounted presenters, before and after the selection moves, and with a second presenter installed
 * to make sure a choice is being made rather than everything being drawn.
 *
 * Keys rather than prose: which words are on screen is the catalogue's business, and these
 * assertions are about how many things are.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        // The key, plus whatever was interpolated into it, so an assertion can tell one row from
        // another without depending on a single English word.
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string) => key,
    }),
}));

afterEach(cleanup);

function change(name: string): DocumentChange {
    return {
        path: [name],
        kind: "changed",
        label: { key: "documentDiff.structural.property", params: { name } },
    };
}

function entry(path: string, tier: DocumentDiffTier = "semantic", changes = 3): DocumentDiffEntry {
    const list = Array.from({ length: changes }, (_, index) => change(`field${index}`));
    return {
        path,
        kind: "changed",
        diff: { changes: list, complete: true, total: list.length, tier },
    };
}

const presenters = (container: HTMLElement): NodeListOf<Element> =>
    container.querySelectorAll("[data-change-presenter]");

describe("ChangeDetailHost", () => {
    it("mounts exactly one presenter", () => {
        const { container } = render(<ChangeDetailHost entry={entry("editor/brand.json")} />);

        expect(presenters(container)).toHaveLength(1);
        expect(presenters(container)[0].getAttribute("data-change-presenter")).toBe("generic");
    });

    it("still mounts exactly one when the selection moves", () => {
        const { container, rerender } = render(<ChangeDetailHost entry={entry("editor/brand.json")} />);
        rerender(<ChangeDetailHost entry={entry("editor/story/index.json")} />);

        expect(presenters(container)).toHaveLength(1);
    });

    it("mounts the one that claims the document, and not the generic one as well", () => {
        registerChangePresenter({
            id: "test-detail-host",
            matches: item => item.path === "editor/ui/uidoc.json",
            Detail: () => <p>claimed</p>,
        });

        const { container } = render(<ChangeDetailHost entry={entry("editor/ui/uidoc.json")} />);

        expect(presenters(container)).toHaveLength(1);
        expect(presenters(container)[0].getAttribute("data-change-presenter")).toBe("test-detail-host");
        expect(container.textContent).toContain("claimed");
    });

    it("states the tier once for the whole detail, not once per change", () => {
        // The caveat rule from the other side: a structural list of JSON paths reads exactly like a
        // semantic list of authored changes, so the caption saying which one it is has to be there -
        // once. Three changes with three captions is the noise the group summary exists to avoid.
        const { container } = render(<ChangeDetailHost entry={entry("editor/brand.json", "structural", 3)} />);

        const captions = [...container.querySelectorAll("p")]
            .filter(node => node.textContent === "documentDiff.tier.structural");
        expect(captions).toHaveLength(1);
    });

    it("scopes the detail to one change when one is selected", () => {
        const document = entry("editor/brand.json", "semantic", 4);

        const { container } = render(
            <ChangeDetailHost entry={document} change={document.diff.changes[1]} />,
        );

        expect(presenters(container)).toHaveLength(1);
        expect(container.textContent).toContain("field1");
        expect(container.textContent).not.toContain("field2");
    });
});
