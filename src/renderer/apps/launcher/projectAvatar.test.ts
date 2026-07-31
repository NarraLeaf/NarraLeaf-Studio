import { describe, expect, it } from "vitest";
import { projectAvatarColor, projectInitials } from "./projectAvatar";

describe("projectInitials", () => {
    it("takes one letter from a single word", () => {
        expect(projectInitials("Demo")).toBe("D");
    });

    it("takes the first letters of the first two words", () => {
        expect(projectInitials("My Game")).toBe("MG");
        expect(projectInitials("my_game")).toBe("MG");
        expect(projectInitials("Aumiao-py")).toBe("AP");
    });

    it("splits camel case", () => {
        expect(projectInitials("CodemaoAutoTop")).toBe("CA");
    });

    /**
     * Both helpers are total. A nameless history record reached this function, threw on
     * `name.length`, and the critical error boundary answered by terminating the app - on every
     * launch, because the record is persisted.
     */
    it("survives a missing, null or empty name instead of throwing", () => {
        expect(projectInitials(undefined)).toBe("?");
        expect(projectInitials(null)).toBe("?");
        expect(projectInitials("")).toBe("?");
        expect(projectInitials("   ")).toBe("?");
        expect(projectInitials("...")).toBe("?");
    });
});

describe("projectAvatarColor", () => {
    it("is stable for a name and different across names", () => {
        expect(projectAvatarColor("My Game")).toBe(projectAvatarColor("My Game"));
        expect(projectAvatarColor("My Game")).not.toBe(projectAvatarColor("Other"));
    });

    it("returns a usable colour for a missing name instead of throwing", () => {
        for (const name of [undefined, null, ""] as const) {
            expect(projectAvatarColor(name)).toMatch(/^hsl\(\d+ 30% 44%\)$/);
        }
    });
});
