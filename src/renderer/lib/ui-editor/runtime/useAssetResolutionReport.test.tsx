// @vitest-environment jsdom
import { useEffect, useState, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetResolutionReport, AssetResolutionSite } from "./assetResolution";
import {
    AssetResolutionReporterContext,
    readAssetResolutionOutcome,
    useAssetResolutionReport,
} from "./useAssetResolutionReport";

afterEach(cleanup);

const GOOD = "93bad884-1f14-4ad2-85fb-c05d7b5ffef6";
const GONE = "4b645b59-1723-4ac9-98ab-e6859b837bef";
const URLS: Record<string, string> = { [GOOD]: "app://fs/good" };

const SITE: AssetResolutionSite = {
    surfaceId: "surface-title",
    elementId: "element-art",
    ownerName: "Art",
    slot: "imageFill",
    instanceKey: "",
};

type Answer = { url: string | null; loading: boolean; error: string | null };

/**
 * The shape of `useAssetObjectUrl` that matters here: it starts blank, answers in an effect keyed on
 * the id, and hands back a fresh state object every time it answers.
 */
function useLookup(id: string | null): Answer {
    const [answer, setAnswer] = useState<Answer>({ url: null, loading: false, error: null });
    useEffect(() => {
        if (!id) {
            setAnswer({ url: null, loading: false, error: null });
            return;
        }
        const url = URLS[id];
        setAnswer(url ? { url, loading: false, error: null } : { url: null, loading: false, error: "Asset not found" });
    }, [id]);
    return answer;
}

function Slot(props: { id: string | null; wanted?: boolean; loadFailedUrl?: string | null; tick?: number }): ReactNode {
    const answer = useLookup(props.id);
    useAssetResolutionReport(SITE, {
        requested: props.id,
        wanted: props.wanted ?? true,
        answer,
        loadFailedUrl: props.loadFailedUrl ?? null,
    });
    return <span data-tick={props.tick ?? 0}>{answer.url ?? ""}</span>;
}

function withReporter(reporter: (report: AssetResolutionReport) => void, child: ReactNode): ReactNode {
    return <AssetResolutionReporterContext.Provider value={reporter}>{child}</AssetResolutionReporterContext.Provider>;
}

function outcomes(reporter: ReturnType<typeof vi.fn>): unknown[] {
    return reporter.mock.calls
        .map(([report]) => report as AssetResolutionReport)
        .map(report => (report.type === "outcome" ? report.outcome : "released"));
}

describe("useAssetResolutionReport", () => {
    it("does nothing without a reporter, which is the editor canvas", () => {
        expect(() => render(<Slot id={GONE} />)).not.toThrow();
    });

    it("reports a failure once, however often the widget re-renders", () => {
        const reporter = vi.fn();
        const { rerender } = render(withReporter(reporter, <Slot id={GONE} />));
        for (let tick = 1; tick <= 5; tick += 1) {
            rerender(withReporter(reporter, <Slot id={GONE} tick={tick} />));
        }
        expect(outcomes(reporter)).toEqual([{ status: "failed", requested: GONE, stage: "resolve" }]);
        const [report] = reporter.mock.calls[0] as [AssetResolutionReport];
        expect(report.type === "outcome" && report.site).toEqual(SITE);
    });

    it("says so when the picture draws after all", () => {
        const reporter = vi.fn();
        const { rerender } = render(withReporter(reporter, <Slot id={GONE} />));
        rerender(withReporter(reporter, <Slot id={GOOD} />));
        expect(outcomes(reporter)).toEqual([
            { status: "failed", requested: GONE, stage: "resolve" },
            { status: "drawn" },
        ]);
    });

    it("never reports the new value against the previous value's answer", () => {
        // Rebinding a working picture to a broken one, and back: the render in which the id changes
        // still holds the other id's answer, and reading it would report GOOD as failed or GONE as drawn.
        const reporter = vi.fn();
        const { rerender } = render(withReporter(reporter, <Slot id={GOOD} />));
        rerender(withReporter(reporter, <Slot id={GONE} />));
        rerender(withReporter(reporter, <Slot id={GOOD} />));
        expect(outcomes(reporter)).toEqual([
            { status: "drawn" },
            { status: "failed", requested: GONE, stage: "resolve" },
            { status: "drawn" },
        ]);
    });

    it("reports a slot the widget does not draw as unused, not as failed", () => {
        const reporter = vi.fn();
        render(withReporter(reporter, <Slot id={GONE} wanted={false} />));
        expect(outcomes(reporter)).toEqual([{ status: "unused" }]);
    });

    it("reports a URL the element could not load as a failed load", () => {
        const reporter = vi.fn();
        const { rerender } = render(withReporter(reporter, <Slot id={GOOD} />));
        rerender(withReporter(reporter, <Slot id={GOOD} loadFailedUrl="app://fs/good" />));
        expect(outcomes(reporter)).toEqual([
            { status: "drawn" },
            { status: "failed", requested: GOOD, stage: "load" },
        ]);
    });

    it("says when the drawing goes away, under the same drawing it reported as", () => {
        const reporter = vi.fn();
        const { unmount } = render(withReporter(reporter, <Slot id={GONE} />));
        unmount();
        const reports = reporter.mock.calls.map(([report]) => report as AssetResolutionReport);
        expect(reports.map(report => report.type)).toEqual(["outcome", "released"]);
        expect(reports[1]!.drawing).toBe(reports[0]!.drawing);
    });

    it("tells two drawings of one slot apart", () => {
        const reporter = vi.fn();
        render(withReporter(reporter, <><Slot id={GONE} /><Slot id={GONE} /></>));
        const drawings = new Set(reporter.mock.calls.map(([report]) => (report as AssetResolutionReport).drawing));
        expect(drawings.size).toBe(2);
    });
});

describe("readAssetResolutionOutcome", () => {
    const answer = (fields: Partial<Answer>): Answer => ({ url: null, loading: false, error: null, ...fields });

    it("has nothing to say before the lookup has answered or while it loads", () => {
        expect(readAssetResolutionOutcome({ requested: GONE, wanted: true, answer: answer({}) })).toBeNull();
        expect(readAssetResolutionOutcome({ requested: GONE, wanted: true, answer: answer({ loading: true }) }))
            .toBeNull();
    });

    it("reads an empty request as unused, which is what a binding that answered nothing sends", () => {
        for (const requested of [null, undefined, ""]) {
            expect(readAssetResolutionOutcome({ requested, wanted: true, answer: answer({ error: "x" }) }))
                .toEqual({ status: "unused" });
        }
    });

    it("carries a value that is not a string through as the string a slot would have seen", () => {
        expect(readAssetResolutionOutcome({ requested: { kind: "other" }, wanted: true, answer: answer({ error: "x" }) }))
            .toEqual({ status: "failed", requested: "[object Object]", stage: "resolve" });
    });
});
