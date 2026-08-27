/**
 * Studio's half of the Team protocol, pinned to the names the wire uses.
 *
 * The vocabulary is authored once, and not here: it lives in the Team repository's
 * zero-dependency `@narraleaf/team-protocol` package, which generates
 * `protocol/contract.json` out of itself. `teamContract.json` beside this file is a copy of
 * that generated artifact, and `types/team.ts` is pinned to it below. So these are not two
 * lists somebody keeps in step - one is produced from the other, and Studio's job is to
 * take the copy across and follow it.
 *
 * What this catches: a method renamed in `team.ts` without the contract moving, a
 * capability Studio started checking for that is not in it, a topic built to a different
 * shape, a limit that drifted.
 *
 * What it does not catch, and it is worth being plain about: whether Studio's copy is the
 * current one. Nothing here reaches the Team repository, so a server that has grown a
 * method Studio has not been handed yet passes this suite in silence. What it buys is that
 * bringing the copy across is a diff on a file whose whole purpose is to be compared, and
 * that every constant which has to follow from it fails here until it does.
 */
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
    TEAM_ANCHOR_FIELD_LIMIT,
    TEAM_COMMENT_BODY_LIMIT,
    TEAM_INSTANCE_FIELD_LIMIT,
    TEAM_LIVE_PAYLOAD_LIMIT,
    TEAM_OVERLAY_BODY_LIMIT,
    TEAM_PROTOCOL_VERSION,
    TEAM_SOCKET_PATH,
    TEAM_SUGGESTION_LIMIT,
    TEAM_TOPIC_ADMIN_KEYS,
    TEAM_TOPIC_ADMIN_REFUSALS,
    TEAM_TOPIC_ADMIN_SETTINGS,
    TEAM_TOPIC_ADMIN_USERS,
    TEAM_TOPIC_PROJECTS,
    TeamMethod,
    teamLiveTopic,
    teamProjectClientsTopic,
    teamProjectLiveTopic,
    teamProjectOverlayTopic,
    teamProjectThreadsTopic,
    teamProjectTopic,
    type TeamCapability,
    type TeamErrorCode,
} from "./team";

interface Contract {
    protocol: number;
    socketPath: string;
    capabilities: string[];
    errorCodes: string[];
    methods: string[];
    topics: Record<string, string>;
    limits: Record<string, number>;
}

const contract = JSON.parse(
    fs.readFileSync(path.join(__dirname, "teamContract.json"), "utf-8"),
) as Contract;

/**
 * The unions written out, because a type cannot be enumerated at runtime.
 *
 * Kept beside the assertion rather than exported: their only reader is this file, and a
 * list of capability names exported from a test is a list somebody would use.
 */
const CAPABILITIES: TeamCapability[] = [
    "session",
    "comments",
    "clients",
    "live",
    "overlay",
    "admin",
    "password-sign-in",
    "project-history",
];
const ERROR_CODES: TeamErrorCode[] = [
    "unknown-method",
    "bad-params",
    "not-found",
    "refused",
    "conflict",
    "unavailable",
    "unauthenticated",
    "internal",
];

describe("the protocol contract", () => {
    it("is the version this build speaks", () => {
        expect(TEAM_PROTOCOL_VERSION).toBe(contract.protocol);
        expect(TEAM_SOCKET_PATH).toBe(contract.socketPath);
    });

    it("names every method the contract names, and no others", () => {
        expect(Object.values(TeamMethod).slice().sort()).toEqual([...contract.methods].sort());
    });

    it("knows every capability and every refusal the contract names", () => {
        expect(CAPABILITIES.slice().sort()).toEqual([...contract.capabilities].sort());
        expect(ERROR_CODES.slice().sort()).toEqual([...contract.errorCodes].sort());
    });

    it("builds or names the topics the contract spells out", () => {
        // Every topic the contract carries is one of the assertions below. Without this the
        // four that arrived with the management family would have been four names Studio
        // never learned, and nothing here would have said so.
        expect(Object.keys(contract.topics).slice().sort()).toEqual([
            "adminKeys",
            "adminRefusals",
            "adminSettings",
            "adminUsers",
            "live",
            "project",
            "projectClients",
            "projectLive",
            "projectOverlay",
            "projectThreads",
            "projects",
        ]);

        expect(TEAM_TOPIC_PROJECTS).toBe(contract.topics["projects"]);
        expect(teamProjectTopic("abc")).toBe(contract.topics["project"]?.replace("{project}", "abc"));
        expect(teamProjectThreadsTopic("abc")).toBe(
            contract.topics["projectThreads"]?.replace("{project}", "abc"),
        );
        expect(teamProjectOverlayTopic("abc")).toBe(
            contract.topics["projectOverlay"]?.replace("{project}", "abc"),
        );
        expect(teamProjectClientsTopic("abc")).toBe(
            contract.topics["projectClients"]?.replace("{project}", "abc"),
        );
        expect(teamProjectLiveTopic("abc")).toBe(
            contract.topics["projectLive"]?.replace("{project}", "abc"),
        );
        expect(teamLiveTopic("xyz")).toBe(contract.topics["live"]?.replace("{session}", "xyz"));

        // Compared rather than built: these name the server, not a project or a session,
        // so there is no id to substitute and `team.ts` states them as constants.
        expect(TEAM_TOPIC_ADMIN_USERS).toBe(contract.topics["adminUsers"]);
        expect(TEAM_TOPIC_ADMIN_SETTINGS).toBe(contract.topics["adminSettings"]);
        expect(TEAM_TOPIC_ADMIN_KEYS).toBe(contract.topics["adminKeys"]);
        expect(TEAM_TOPIC_ADMIN_REFUSALS).toBe(contract.topics["adminRefusals"]);
    });

    it("bounds what it sends at the sizes the contract states", () => {
        expect(TEAM_ANCHOR_FIELD_LIMIT).toBe(contract.limits["anchorField"]);
        expect(TEAM_COMMENT_BODY_LIMIT).toBe(contract.limits["commentBody"]);
        expect(TEAM_SUGGESTION_LIMIT).toBe(contract.limits["suggestion"]);
        expect(TEAM_OVERLAY_BODY_LIMIT).toBe(contract.limits["overlayBody"]);
        expect(TEAM_LIVE_PAYLOAD_LIMIT).toBe(contract.limits["livePayload"]);
        expect(TEAM_INSTANCE_FIELD_LIMIT).toBe(contract.limits["instanceField"]);
    });
});
