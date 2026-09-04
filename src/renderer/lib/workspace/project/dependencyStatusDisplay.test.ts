import { describe, expect, it } from "vitest";
import { describeDependencyState } from "./dependencyStatusDisplay";

const SWITCHED_OFF = { status: "satisfied", suppressed: false, installedEnabled: false } as const;
const WITHHELD = { status: "incompatible", suppressed: true, installedEnabled: true } as const;

describe("describeDependencyState", () => {
    it("says nothing about a plugin that is installed, compatible and loaded", () => {
        expect(describeDependencyState({ status: "satisfied", suppressed: false, installedEnabled: true })).toBeNull();
    });

    it("says nothing before the first resolve, when there is no verdict yet", () => {
        expect(describeDependencyState({})).toBeNull();
    });

    /**
     * A hard dependency on a plugin nobody has installed is `suppressed` too - trivially, since
     * there is nothing to load - and the row used to spend the withheld word on it. That word says
     * Studio turned something down over its version, which sends the author looking for a plugin
     * and a switch that are not there.
     */
    it("says a plugin is missing rather than withheld when there is nothing installed", () => {
        expect(describeDependencyState({ status: "missing", suppressed: true, installedEnabled: undefined }))
            .toEqual({ labelKey: "project.dependencies.status.missing", className: "text-danger" });
    });

    it("writes the version verdict for a plugin Studio withheld from the project", () => {
        expect(describeDependencyState(WITHHELD))
            .toEqual({ labelKey: "project.dependencies.status.suppressed", className: "text-danger" });
    });

    it("writes the switch for a plugin the author switched off", () => {
        // The gap this covers: the plugin is installed and its version is fine, so the row used to
        // read as ready while every type the plugin contributes was an unknown one in the project.
        expect(describeDependencyState(SWITCHED_OFF))
            .toEqual({ labelKey: "project.dependencies.status.disabled", className: "text-danger" });
    });

    /**
     * The two states are one word apart and mean opposite things about who acted, so the pair is
     * asserted rather than left to two separate cases that could quietly converge on one key.
     */
    it("never writes one word for both, whatever else is true of the row", () => {
        const switchedOff = describeDependencyState(SWITCHED_OFF)?.labelKey;
        const withheld = describeDependencyState(WITHHELD)?.labelKey;
        expect(switchedOff).toBe("project.dependencies.status.disabled");
        expect(withheld).toBe("project.dependencies.status.suppressed");
        expect(switchedOff).not.toBe(withheld);
    });

    it("prefers the switch over an older version, which is not why nothing loads", () => {
        expect(describeDependencyState({ status: "outdated", suppressed: false, installedEnabled: false })?.labelKey)
            .toBe("project.dependencies.status.disabled");
    });

    it("writes the version verdict when the plugin is absent, which has no switch", () => {
        expect(describeDependencyState({ status: "missing", suppressed: false }))
            .toEqual({ labelKey: "project.dependencies.status.missing", className: "text-danger" });
        expect(describeDependencyState({ status: "outdated", suppressed: false, installedEnabled: true }))
            .toEqual({ labelKey: "project.dependencies.status.outdated", className: "text-warning" });
    });
});
