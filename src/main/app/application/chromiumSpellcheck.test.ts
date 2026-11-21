import { describe, expect, it } from "vitest";
import {
    disableChromiumSpellchecker,
    disableChromiumSpellcheckerForAllSessions,
    type SpellcheckerSession,
} from "./chromiumSpellcheck";

function fakeSession(options: { throwOnLanguages?: boolean } = {}) {
    const calls: string[] = [];
    const session: SpellcheckerSession = {
        setSpellCheckerEnabled: enable => {
            calls.push(`enabled:${enable}`);
        },
        setSpellCheckerLanguages: languages => {
            if (options.throwOnLanguages) {
                throw new Error("no");
            }
            calls.push(`languages:${languages.join(",")}`);
        },
    };
    return { session, calls };
}

describe("disableChromiumSpellchecker", () => {
    it("switches the checker off and empties the languages on Windows and Linux", () => {
        for (const platform of ["win32", "linux"] as const) {
            const { session, calls } = fakeSession();
            disableChromiumSpellchecker(session, platform);
            expect(calls).toEqual(["enabled:false", "languages:"]);
        }
    });

    it("leaves the language list alone on macOS, where it is a no-op", () => {
        const { session, calls } = fakeSession();
        disableChromiumSpellchecker(session, "darwin");
        expect(calls).toEqual(["enabled:false"]);
    });

    it("never throws", () => {
        const { session, calls } = fakeSession({ throwOnLanguages: true });
        expect(() => disableChromiumSpellchecker(session, "linux")).not.toThrow();
        expect(calls).toEqual(["enabled:false"]);
    });
});

describe("disableChromiumSpellcheckerForAllSessions", () => {
    it("switches off every session created after it is installed", () => {
        let listener: ((session: SpellcheckerSession) => void) | null = null;
        disableChromiumSpellcheckerForAllSessions({
            on: (event, handler) => {
                expect(event).toBe("session-created");
                listener = handler;
            },
        }, "win32");
        const first = fakeSession();
        const second = fakeSession();
        listener!(first.session);
        listener!(second.session);
        expect(first.calls).toEqual(["enabled:false", "languages:"]);
        expect(second.calls).toEqual(["enabled:false", "languages:"]);
    });
});
