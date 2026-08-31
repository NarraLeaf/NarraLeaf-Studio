/**
 * The script the debug server asks the workspace window to run.
 *
 * It is a string built in the main process and evaluated in the renderer, which is the one part of
 * this surface that cannot fail loudly: every mistake inside it - a syntax slip, a member that is
 * not there, a call that throws - comes back as `available: false` with a reason, and every one of
 * those reads like a perfectly ordinary "no bridge yet". So the four answers it can give are pinned
 * here by running it, against a window object standing in for the renderer's.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { buildBridgeCallScript } from "./studioDebugServer";

const ANOMALIES_BODY = "return {available:true,data:{anomalies:d.anomalies()}};";

/** Run the built script the way `executeJavaScript` would, with a stand-in `window`. */
function run(script: string, window: unknown): { available: boolean; reason?: string; data?: unknown } {
    return new Function("window", `return ${script}`)(window);
}

describe("the bridge call script", () => {
    it("says the bridge is missing when the renderer has none", () => {
        expect(run(buildBridgeCallScript("anomalies", ANOMALIES_BODY), {})).toEqual({
            available: false,
            reason: "bridge-not-installed",
        });
    });

    it("tells a bridge without the member from a bridge that is not there", () => {
        const window = { __NLS_STUDIO_DEBUG__: { version: 1, console: {} } };
        expect(run(buildBridgeCallScript("anomalies", ANOMALIES_BODY), window)).toEqual({
            available: false,
            reason: "bridge-too-old",
        });
    });

    it("answers with what the bridge returned", () => {
        const anomalies = [{ id: "anomaly-1", source: "assets", severity: "degraded" }];
        const window = { __NLS_STUDIO_DEBUG__: { anomalies: () => anomalies } };
        expect(run(buildBridgeCallScript("anomalies", ANOMALIES_BODY), window)).toEqual({
            available: true,
            data: { anomalies },
        });
    });

    it("carries back the message of a call that threw, rather than throwing", () => {
        const window = {
            __NLS_STUDIO_DEBUG__: {
                anomalies: () => {
                    throw new Error("the log is on fire");
                },
            },
        };
        expect(run(buildBridgeCallScript("anomalies", ANOMALIES_BODY), window)).toEqual({
            available: false,
            reason: "the log is on fire",
        });
    });

    it("hands the console its options as the values they were", () => {
        const options = { channel: "build", level: "warning", limit: 20 };
        const script = buildBridgeCallScript(
            "console",
            `return {available:true,data:d.console.snapshot(${JSON.stringify(options)})};`,
        );
        const window = {
            __NLS_STUDIO_DEBUG__: { console: { snapshot: (given: unknown) => ({ given }) } },
        };
        expect(run(script, window)).toEqual({ available: true, data: { given: options } });
    });

    it("does not let a member name break out of the check it is written into", () => {
        // The names are literals in this file rather than anything a request carries, but the
        // encoding is what keeps that a fact about today's callers rather than a rule to remember.
        const script = buildBridgeCallScript("']; throw new Error('escaped'); ['", ANOMALIES_BODY);
        expect(run(script, { __NLS_STUDIO_DEBUG__: { anomalies: () => [] } })).toEqual({
            available: false,
            reason: "bridge-too-old",
        });
    });
});
