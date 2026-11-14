import { describe, expect, it } from "vitest";

import { deepLinkInArgv, parseTeamDeepLink } from "./teamDeepLink";

describe("a narraleaf:// link", () => {
    it("reads a connect link to an https server", () => {
        expect(parseTeamDeepLink("narraleaf://team/connect?server=https://team.example:41402/anything"))
            .toEqual({ kind: "connect", server: "https://team.example:41402" });
    });

    it("reads an open link with its anchor", () => {
        expect(parseTeamDeepLink("narraleaf://team/open?server=https://t.example&project=ab12&doc=story:main&element=b7"))
            .toEqual({ kind: "open", server: "https://t.example", project: "ab12", doc: "story:main", element: "b7" });
    });

    it("ignores what is not one: another scheme, plain http, credentials, unknown actions", () => {
        for (const link of [
            "https://team/connect?server=https://t.example",
            "narraleaf://team/connect?server=http://t.example",
            "narraleaf://team/connect?server=https://user:pw@t.example",
            "narraleaf://team/delete?server=https://t.example",
            "narraleaf://team/open?server=https://t.example&project=../../x",
            "narraleaf://other/connect?server=https://t.example",
            "not a url",
        ]) {
            expect(parseTeamDeepLink(link)).toBeNull();
        }
    });

    it("is found in a second launch's argv", () => {
        expect(deepLinkInArgv(["/Applications/Studio", "--flag", "narraleaf://team/connect?server=https://t"]))
            .toBe("narraleaf://team/connect?server=https://t");
        expect(deepLinkInArgv(["/Applications/Studio"])).toBeUndefined();
    });
});
