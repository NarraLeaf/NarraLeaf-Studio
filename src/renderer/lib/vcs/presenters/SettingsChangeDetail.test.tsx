// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { diffProjectConfig } from "@shared/documents/specs/project";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { ChangeDetailHost } from "./ChangeDetailHost";

/**
 * The project's own settings, drawn the way an author meets them.
 *
 * Mounted through `ChangeDetailHost` rather than directly, so the registry's answer is under test
 * as well as the pane: a presenter that draws perfectly and is never chosen is the same blank
 * half-screen it replaced.
 *
 * The diff is produced by the real spec from a real pair of configurations, because the shape this
 * pane relies on - one group per area of the project, the fields inside it as children - is the
 * spec's decision and not this file's. A hand-built diff would keep passing after the spec stopped
 * producing groups at all.
 *
 * Keys rather than English: which words are on screen is the catalogue's business. The VALUES are
 * the author's own data, so they are asserted verbatim.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        // The bare key, so anything else on screen is a value rather than a translated word.
        t: (key: string) => key,
        has: () => false,
        tn: (key: string) => key,
    }),
}));

afterEach(cleanup);

const base: ProjectConfigData = {
    name: "Chronicle",
    identifier: "com.example.chronicle",
    metadata: {
        version: "1.2.0",
        author: "Ada Lovelace",
        resolution: { width: 1920, height: 1080 },
    },
    app: {
        network: { policy: "deny", allowHttp: false },
        preferences: { cps: 30, globalVolume: 0.8 },
        autoSave: { enabled: true, intervalSeconds: 300, slots: 3 },
    },
};

/** One evening's edits: a rename, a smaller window, a policy, a text speed, autosaving switched off. */
const head: ProjectConfigData = {
    ...base,
    name: "Chronicle II",
    metadata: {
        ...base.metadata,
        version: "1.3.0",
        resolution: { width: 1280, height: 720 },
    },
    app: {
        network: { policy: "allowlist", allowHttp: false },
        preferences: { cps: 45, globalVolume: 0.8 },
    },
};

const entry: DocumentDiffEntry = {
    path: "Chronicle.nlproj",
    kind: "changed",
    documentKind: "project",
    diff: diffProjectConfig(base, head, { limit: 200 }),
};

const cards = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>("[data-settings-section]")];

/** The two values a row sits between: monospaced, and not the change marker, which is decorative. */
const values = (scope: HTMLElement): string[] =>
    [...scope.querySelectorAll("span.font-mono:not([aria-hidden])")].map(node => node.textContent ?? "");

describe("a project's settings", () => {
    it("is drawn by the settings presenter and by nothing else", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        const mounted = container.querySelectorAll("[data-change-presenter]");
        expect(mounted).toHaveLength(1);
        expect(mounted[0].getAttribute("data-change-presenter")).toBe("settings");
    });

    it("makes a card of every area that changed, in the order the spec put them in", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        expect(cards(container).map(card => card.getAttribute("data-settings-section"))).toEqual([
            // The application's name is a setting of the document itself, not of any area, so it is
            // in the card that carries no heading.
            "",
            "app/network",
            "app/preferences",
            "app/autoSave",
            "metadata",
        ]);
    });

    it("names each card with the area's own words and its marker", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [, network, , autoSave] = cards(container);

        expect(network.textContent).toContain("documentDiff.project.network");
        // The area went away, and the card wears the same marker the row it replaced wore.
        expect(autoSave.textContent).toContain("documentDiff.project.autoSave");
        expect(autoSave.textContent).toContain("−");
    });

    it("puts each setting under its own area, with the two values on the row", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);
        const [identity, network, preferences, autoSave, metadata] = cards(container);

        expect(identity.textContent).toContain("documentDiff.project.name");
        expect(values(identity)).toEqual(["Chronicle", "Chronicle II"]);

        expect(network.textContent).toContain("documentDiff.project.networkPolicy");
        expect(values(network)).toEqual(["deny", "allowlist"]);

        // As a percentage, which is the number on the slider the author moved.
        expect(preferences.textContent).toContain("documentDiff.project.prefTextSpeed");
        expect(values(preferences)).toEqual(["30", "45"]);

        // A window size is one value and reads as one, rather than as two rows of numbers.
        expect(metadata.textContent).toContain("documentDiff.project.metaResolution");
        expect(values(metadata)).toEqual(["1920×1080", "1280×720", "1.2.0", "1.3.0"]);

        // Every field of a removed area is still listed, each with the value it is losing and no
        // second value: an area that went away is not an area whose settings all became blank.
        expect(values(autoSave)).toEqual(["true", "300", "3"]);
    });

    it("says nothing about a tier, because a card already claims the strongest one", () => {
        const { container } = render(<ChangeDetailHost entry={entry} />);

        // `semantic` is the one tier with no caveat to make. A caption per card would be the same
        // caveat five times over, which is the noise the sections exist to remove.
        expect(container.textContent).not.toContain("documentDiff.tier.");
    });
});

describe("a settings document the cards cannot claim", () => {
    const structural = (): DocumentDiffEntry => ({
        ...entry,
        diff: { ...entry.diff, tier: "structural" },
    });

    it("falls back to the plain list, with the caveat that list states", () => {
        const { container } = render(<ChangeDetailHost entry={structural()} />);

        // Still one presenter, and still this one - the fallback is a body it renders, not a second
        // presenter that got mounted beside it.
        const mounted = container.querySelectorAll("[data-change-presenter]");
        expect(mounted).toHaveLength(1);
        expect(mounted[0].getAttribute("data-change-presenter")).toBe("settings");

        expect(cards(container)).toHaveLength(0);
        // A list of JSON paths is a weaker claim than a list of settings and has to say so.
        expect(container.textContent).toContain("documentDiff.tier.structural");
        expect(container.textContent).toContain("documentDiff.project.networkPolicy");
    });

    it("falls back for one change selected out of the document", () => {
        const { container } = render(
            <ChangeDetailHost entry={entry} change={entry.diff.changes[1]} />,
        );

        // One card holding one row says less than the row does, and hides the other four areas.
        expect(cards(container)).toHaveLength(0);
        expect(container.textContent).toContain("documentDiff.project.network");
    });

    it("states the file that appeared as one fact rather than as an empty pane", () => {
        const added: DocumentDiffEntry = {
            path: "Chronicle.nlproj",
            kind: "added",
            documentKind: "project",
            diff: {
                changes: [{ path: [], kind: "added", label: { key: "documentDiff.document.added", params: { bytes: 12488 } } }],
                complete: true,
                total: 1,
                tier: "opaque",
            },
        };

        const { container } = render(<ChangeDetailHost entry={added} />);

        expect(cards(container)).toHaveLength(0);
        expect(container.textContent).toContain("documentDiff.document.added");
        // The caveat about how it was compared stays suppressed, because nothing was compared.
        expect(container.textContent).not.toContain("documentDiff.tier.opaque");
    });
});
