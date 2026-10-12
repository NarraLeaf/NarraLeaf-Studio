import { describe, expect, it } from "vitest";
import { ONBOARDING_VERSION, onboardingMarkerMovesBack } from "@shared/constants/onboarding";
import { WindowAppType } from "@shared/types/window";
import { FirstRunSetupGate } from "./firstRunSetupGate";

/**
 * Which window is first-run setup is main's record of the launcher it opened in setup, not anything a
 * renderer can write. The gate lets through that window only, and closes for good when the marker says
 * setup is finished.
 */

function windowOf(windowType: WindowAppType) {
    let closed = false;
    return {
        getWindowType: () => windowType,
        isClosed: () => closed,
        close: () => {
            closed = true;
        },
    };
}

describe("FirstRunSetupGate", () => {
    it("passes only the launcher it was told about", () => {
        const gate = new FirstRunSetupGate();
        const setup = windowOf(WindowAppType.Launcher);
        const other = windowOf(WindowAppType.Launcher);
        gate.open(setup);
        expect(gate.passes(setup)).toBe(true);
        expect(gate.passes(other)).toBe(false);
    });

    it("never passes a window that is not a launcher, even when marked", () => {
        const gate = new FirstRunSetupGate();
        for (const windowType of [WindowAppType.Workspace, WindowAppType.DevMode, WindowAppType.Settings]) {
            const window = windowOf(windowType);
            gate.open(window);
            expect(gate.passes(window)).toBe(false);
        }
    });

    it("stops passing a closed window", () => {
        const gate = new FirstRunSetupGate();
        const setup = windowOf(WindowAppType.Launcher);
        gate.open(setup);
        setup.close();
        expect(gate.passes(setup)).toBe(false);
    });

    it("closes when the marker says setup is finished, and is not reopened by writing the marker", () => {
        const gate = new FirstRunSetupGate();
        const setup = windowOf(WindowAppType.Launcher);
        gate.open(setup);
        gate.noteMarker(0);
        expect(gate.passes(setup)).toBe(true);
        gate.noteMarker(ONBOARDING_VERSION);
        expect(gate.passes(setup)).toBe(false);
        gate.noteMarker(0);
        gate.noteMarker(undefined);
        expect(gate.passes(setup)).toBe(false);
    });
});

describe("onboardingMarkerMovesBack", () => {
    it("allows recording that setup is done, and the same revision again", () => {
        expect(onboardingMarkerMovesBack(undefined, ONBOARDING_VERSION)).toBe(false);
        expect(onboardingMarkerMovesBack(ONBOARDING_VERSION, ONBOARDING_VERSION)).toBe(false);
        expect(onboardingMarkerMovesBack(ONBOARDING_VERSION, ONBOARDING_VERSION + 1)).toBe(false);
    });

    it("refuses a value that reads as not done, and an older revision than the stored one", () => {
        for (const next of [0, ONBOARDING_VERSION - 1, Number.NaN, "1", null, undefined]) {
            expect(onboardingMarkerMovesBack(ONBOARDING_VERSION, next)).toBe(true);
        }
        expect(onboardingMarkerMovesBack(ONBOARDING_VERSION + 1, ONBOARDING_VERSION)).toBe(true);
    });
});
