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
});
