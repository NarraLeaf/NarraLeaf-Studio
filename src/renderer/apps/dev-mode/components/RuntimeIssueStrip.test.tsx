// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeIssueStrip } from "./RuntimeIssueStrip";
import type { LocatedRuntimeIssue } from "./runtimeIssueModel";

/**
 * Which failure the one-line strip over the Dev Mode stage names.
 *
 * Pinned because it named the wrong one: a session that failed to reload - the project had been
 * taken by another Studio - painted the strip in the error colour and headlined a warning from
 * minutes earlier, leaving the reason on the second line of a panel nobody had opened.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) =>
            (params ? `${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")}` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

const REFUSAL = "Dev Mode is unavailable: this project is open in another NarraLeaf Studio on this computer.";

function warning(id: string, message: string): LocatedRuntimeIssue {
    return { id, level: "warning", message, origin: "interface", location: null };
}

afterEach(cleanup);

describe("RuntimeIssueStrip", () => {
    it("headlines an unacknowledged session failure over older located issues", () => {
        render(
            <RuntimeIssueStrip
                sessionError={REFUSAL}
                issues={[warning("a", "An image could not be found"), warning("b", "Another one")]}
                onDismiss={() => undefined}
                onOpenIssues={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: REFUSAL })).toBeTruthy();
        expect(screen.queryByText("An image could not be found")).toBeNull();
    });

    it("headlines the newest located issue when the session is fine", () => {
        render(
            <RuntimeIssueStrip
                sessionError={null}
                issues={[warning("a", "An image could not be found"), warning("b", "Another one")]}
                onDismiss={() => undefined}
                onOpenIssues={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: "An image could not be found" })).toBeTruthy();
    });

    it("headlines the first line of a session failure that runs to several", () => {
        render(
            <RuntimeIssueStrip
                sessionError={`\n${REFUSAL}\nat compile (bundle.ts:1)`}
                issues={[warning("a", "An image could not be found")]}
                onDismiss={() => undefined}
                onOpenIssues={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: REFUSAL })).toBeTruthy();
    });

    /**
     * What the tally is a tally OF.
     *
     * Dev Mode reports what the running game ran into; it does not run the project check. A strip
     * that said a bare "0 errors" over a project the project check has a hundred errors to say about
     * was read as a clean bill, so the string names the run and these pin that it is the string the
     * strip reaches for - with the counts it actually counted.
     */
    it("tallies this run's own errors and warnings, and says that is what it counted", () => {
        render(
            <RuntimeIssueStrip
                sessionError={null}
                issues={Array.from({ length: 20 }, (_, index) => warning(`w${index}`, `Warning ${index}`))}
                onDismiss={() => undefined}
                onOpenIssues={() => undefined}
            />,
        );

        expect(screen.getByText("devMode.issues.summary|errors=0,warnings=20")).toBeTruthy();
    });

    it("counts a mixed list by level", () => {
        render(
            <RuntimeIssueStrip
                sessionError={null}
                issues={[
                    { id: "e", level: "error", message: "A node stopped", origin: "interface", location: null },
                    warning("a", "An image could not be found"),
                    warning("b", "Another one"),
                ]}
                onDismiss={() => undefined}
                onOpenIssues={() => undefined}
            />,
        );

        expect(screen.getByText("devMode.issues.summary|errors=1,warnings=2")).toBeTruthy();
    });
});
