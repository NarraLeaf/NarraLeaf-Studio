import { describe, expect, it } from "vitest";
import { describeDependencyBanner, describeDependencyState } from "./dependencyStatusDisplay";

const SWITCHED_OFF = { status: "satisfied", suppressed: false, installedEnabled: false } as const;
const WITHHELD = { status: "incompatible", suppressed: true, installedEnabled: true } as const;
const MISSING = { status: "missing", suppressed: true, installedEnabled: undefined } as const;
const AWAITING_GRANT = { status: "satisfied", suppressed: false, installedEnabled: true, installedStatus: "needsAuthorization" } as const;
const FAILED = { status: "satisfied", suppressed: false, installedEnabled: true, installedStatus: "error" } as const;
const READY = { status: "satisfied", suppressed: false, installedEnabled: true, installedStatus: "enabled" } as const;
const OUTDATED = { status: "outdated", suppressed: false, installedEnabled: true } as const;

describe("describeDependencyState - the plugin's own state", () => {
    /**
     * Installed, switched on, at a usable version, and contributing nothing: the version verdict
     * reads "satisfied" for both, and Project ▸ App used to write nothing beside them at all.
     */
    it("writes the Plugins panel's word for a plugin waiting for its permissions", () => {
        expect(describeDependencyState(AWAITING_GRANT))
            .toEqual({ labelKey: "plugins.status.needsAuthorization", className: "text-warning" });
    });

    it("writes the Plugins panel's word for a plugin that failed to load", () => {
        expect(describeDependencyState(FAILED))
            .toEqual({ labelKey: "plugins.workspace.activity.failed", className: "text-danger" });
    });

    it("writes the authorization, not the switch, for a plugin whose grant was declined", () => {
        // Declining switches it off as well; what the Plugins panel shows and offers is the grant.
        expect(describeDependencyState({ ...AWAITING_GRANT, installedEnabled: false })?.labelKey)
            .toBe("plugins.status.needsAuthorization");
    });

    it("writes the switch for a plugin switched off after it failed", () => {
        expect(describeDependencyState({ ...FAILED, installedEnabled: false })?.labelKey)
            .toBe("project.dependencies.status.disabled");
    });

    it("writes the hold over the plugin's own state, which would not matter while it is held", () => {
        expect(describeDependencyState({ ...WITHHELD, installedStatus: "needsAuthorization" })?.labelKey)
            .toBe("project.dependencies.status.suppressed");
    });
});

describe("describeDependencyBanner", () => {
    it("shows nothing when every row is ready", () => {
        expect(describeDependencyBanner([READY, READY])).toBeNull();
        expect(describeDependencyBanner([])).toBeNull();
    });

    /**
     * The defect this replaces: the red banner was picked by the overall verdict, which is `blocked`
     * for an absent hard dependency too, and it said the installed version was incompatible.
     */
    it("says a missing plugin is not installed, and nothing about its version", () => {
        expect(describeDependencyBanner([MISSING])).toEqual({
            tone: "danger",
            lines: [{ key: "project.dependencies.banner.missing", count: 1 }],
        });
    });

    it("sends a held plugin to Rescan with its own sentence", () => {
        expect(describeDependencyBanner([WITHHELD])?.lines)
            .toEqual([{ key: "project.dependencies.banner.held", count: 1 }]);
    });

    it("gives every state present its own sentence and count, most blocking first", () => {
        expect(describeDependencyBanner([OUTDATED, FAILED, SWITCHED_OFF, AWAITING_GRANT, WITHHELD, MISSING, WITHHELD]))
            .toEqual({
                tone: "danger",
                lines: [
                    { key: "project.dependencies.banner.missing", count: 1 },
                    { key: "project.dependencies.banner.held", count: 2 },
                    { key: "project.dependencies.banner.needsAuthorization", count: 1 },
                    { key: "project.dependencies.banner.disabled", count: 1 },
                    { key: "project.dependencies.banner.failed", count: 1 },
                    { key: "project.dependencies.banner.outdated", count: 1 },
                ],
            });
    });

    it("is a warning, not a danger, when every plugin still loads", () => {
        expect(describeDependencyBanner([OUTDATED, READY])?.tone).toBe("warning");
        expect(describeDependencyBanner([{ status: "incompatible", suppressed: false, installedEnabled: true }]))
            .toEqual({ tone: "warning", lines: [{ key: "project.dependencies.banner.incompatible", count: 1 }] });
    });

    it("is a danger for a plugin that is installed and on and still contributes nothing", () => {
        expect(describeDependencyBanner([AWAITING_GRANT])?.tone).toBe("danger");
        expect(describeDependencyBanner([FAILED])?.tone).toBe("danger");
    });
});

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
