import { describe, expect, it } from "vitest";
import { describeDependencyState } from "./dependencyStatusDisplay";

describe("describeDependencyState", () => {
    it("says nothing about a plugin that is installed, compatible and loaded", () => {
        expect(describeDependencyState({ status: "satisfied", suppressed: false, installedEnabled: true })).toBeNull();
    });

    it("says nothing before the first resolve, when there is no verdict yet", () => {
        expect(describeDependencyState({})).toBeNull();
    });

    it("writes the version verdict for a plugin Studio withheld from the project", () => {
        expect(describeDependencyState({ status: "incompatible", suppressed: true, installedEnabled: true }))
            .toEqual({ labelKey: "project.dependencies.status.disabled", className: "text-danger" });
    });

    it("separates a plugin the author switched off from one Studio withheld", () => {
        // The gap this covers: the plugin is installed and its version is fine, so the row used to
        // read as ready while every type the plugin contributes was an unknown one in the project.
        expect(describeDependencyState({ status: "satisfied", suppressed: false, installedEnabled: false }))
            .toEqual({ labelKey: "project.dependencies.status.switchedOff", className: "text-danger" });
    });

    it("prefers the switch over an older version, which is not why nothing loads", () => {
        expect(describeDependencyState({ status: "outdated", suppressed: false, installedEnabled: false })?.labelKey)
            .toBe("project.dependencies.status.switchedOff");
    });

    it("writes the version verdict when the plugin is absent, which has no switch", () => {
        expect(describeDependencyState({ status: "missing", suppressed: false }))
            .toEqual({ labelKey: "project.dependencies.status.missing", className: "text-danger" });
        expect(describeDependencyState({ status: "outdated", suppressed: false, installedEnabled: true }))
            .toEqual({ labelKey: "project.dependencies.status.outdated", className: "text-warning" });
    });
});
