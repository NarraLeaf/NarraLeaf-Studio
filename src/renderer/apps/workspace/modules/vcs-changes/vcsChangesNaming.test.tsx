// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffResult } from "@/lib/vcs/useDocumentDiff";
import { comparisonHeading, VcsChangesTab } from "./VcsChangesTab";
import { vcsChangesTabTitle } from "./openVcsChangesTab";

/**
 * How the comparison names the versions it is between.
 *
 * A version is `#12` everywhere in Studio - the rail, the status cell, the switcher menu - and this
 * tab was the one surface that could call the same version `a91f3c8`. It did so whenever the opener
 * had not pre-rendered a name into the payload, which made the fallback both invisible in the
 * ordinary case and guaranteed in the restored one. What is pinned here is that a hash cannot come
 * back: the payload carries NUMBERS, and the two sentences the tab draws are built from them.
 *
 * Read through the real translator rather than a stub, so these assert the text an author sees.
 * `a91f3c8` is the head hash in every fixture below and never appears in an expectation.
 */

const HEAD = "a91f3c8d2e4b6";

const vcs = vi.hoisted(() => ({
    getInfo: vi.fn(async (): Promise<unknown> => ({
        root: "/project",
        repositoryId: "repo",
        head: "a91f3c8d2e4b6",
        headNumber: 36,
        branch: "main",
    })),
}));

// Both spellings: the tab names itself through the comparison's naming layer, which reads the
// workspace optionally so it can also be mounted where there is not a whole one.
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => vcs } } }),
    useOptionalWorkspace: () => ({ context: { services: { get: () => vcs } } }),
}));

const diff = vi.hoisted(() => ({
    result: null as DocumentDiffResult | null,
}));
vi.mock("@/lib/vcs/useDocumentDiff", () => ({
    useDocumentDiff: () => ({ loading: false, error: null, result: diff.result, reload: () => undefined }),
    findDocumentDiffEntry: () => null,
}));

// The help affordance reads a workspace of its own, and this file is about two sentences.
vi.mock("@/lib/help", () => ({ HelpTrigger: () => null }));

afterEach(() => {
    cleanup();
    vcs.getInfo.mockClear();
});

function workingTreeResult(head?: string): DocumentDiffResult {
    return { documents: [], pathCount: 0, complete: true, readFailure: null, head };
}

/** The header sentence, which is the first thing the tab draws. */
const heading = (container: HTMLElement) => container.textContent ?? "";

describe("what the comparison tab calls a version", () => {
    it("names both sides of a revision pair by number in the tab strip", () => {
        const title = vcsChangesTabTitle({
            mode: "between",
            from: "3ddbc20f1a9",
            to: "a91f3c8d2e4b6",
            fromNumber: 3,
            toNumber: 7,
        });

        expect(title).toBe("#3 → #7");
        // The whole defect in one assertion: the strip used to read `3ddbc20 → a91f3c8`.
        expect(title).not.toMatch(/[0-9a-f]{7}/);
    });

    it("names both sides of a revision pair by number in the header", () => {
        const t = (key: string, params?: Record<string, string>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key);

        expect(comparisonHeading(
            { mode: "between", from: "3ddbc20f1a9", to: HEAD, fromNumber: 3, toNumber: 7 },
            null,
            t,
        )).toBe("documentDiff.tab.comparingRevisions(#3,#7)");
    });

    it("reads the head's number when the payload carries none, rather than showing its hash", async () => {
        // A payload with nothing cached in it. That is what the command palette opens with, what
        // the tab falls back to when it is handed no payload at all, and what any future rebuild
        // from a stored layout would hand it - the case the hash fallback used to be reserved for.
        diff.result = workingTreeResult(HEAD);
        const { container } = render(<VcsChangesTab payload={{ mode: "working-tree" }} />);

        await waitFor(() => expect(heading(container)).toContain("#36"));
        expect(vcs.getInfo).toHaveBeenCalled();
        expect(container.textContent).not.toContain("a91f3c8");
    });

    it("re-reads the head rather than trusting the number it was opened with", async () => {
        // A commit landed while the tab was open: the head moved, so the number the opener passed
        // now names the version BEFORE the one the comparison is actually against.
        diff.result = workingTreeResult(HEAD);
        const { container } = render(<VcsChangesTab payload={{ mode: "working-tree", headNumber: 35 }} />);

        await waitFor(() => expect(heading(container)).toContain("#36"));
        expect(heading(container)).not.toContain("#35");
    });

    it("says 'the last version' when there is no number to show, and never a hash", async () => {
        // A repository with nothing recorded yet: the comparison answers with no head at all.
        diff.result = workingTreeResult(undefined);
        const { container } = render(<VcsChangesTab payload={{ mode: "working-tree" }} />);

        await waitFor(() => expect(heading(container)).toContain("the last version"));
        expect(vcs.getInfo).not.toHaveBeenCalled();
        expect(container.textContent).not.toMatch(/[0-9a-f]{7}/);
    });
});
