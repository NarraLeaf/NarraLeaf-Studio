/**
 * Studio's half of the Team protocol, pinned to the names both halves agree on.
 *
 * `types/team.ts` is a twin of `src/team/protocol.ts` in the Team repository: two copies,
 * because the two release separately and neither depends on the other. Two copies of
 * anything drift, so the names live in `teamContract.json`, of which the server holds a
 * byte-identical copy, and each side pins its own constants to it.
 *
 * What this catches: a method renamed here without the contract moving, a capability
 * Studio started checking for that is not in it, a topic built to a different shape.
 *
 * What it does not catch, and it is worth being plain about: the two JSON files are kept
 * identical by whoever edits them, so a change made in one repository and not the other
 * passes both suites. What it buys is that such a change is a diff on a file whose whole
 * purpose is to be compared, rather than a rename buried in a module.
 */
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
    TEAM_PROTOCOL_VERSION,
    TEAM_SOCKET_PATH,
    TEAM_TOPIC_MEMBERS,
    TEAM_TOPIC_PROJECTS,
    TeamMethod,
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
const CAPABILITIES: TeamCapability[] = ["session", "comments"];
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

    it("builds the topics the contract spells out", () => {
        expect(TEAM_TOPIC_PROJECTS).toBe(contract.topics["projects"]);
        expect(TEAM_TOPIC_MEMBERS).toBe(contract.topics["members"]);
        expect(teamProjectTopic("abc")).toBe(contract.topics["project"]?.replace("{project}", "abc"));
        expect(teamProjectThreadsTopic("abc")).toBe(
            contract.topics["projectThreads"]?.replace("{project}", "abc"),
        );
    });
});
