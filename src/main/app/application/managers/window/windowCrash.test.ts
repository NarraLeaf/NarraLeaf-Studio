import { describe, expect, it } from "vitest";
import { describeWindowSubject } from "./windowCrash";

describe("describeWindowSubject", () => {
    it("names the project folder rather than the whole path", () => {
        expect(describeWindowSubject("D:\\Dev\\games\\Moonlight")).toBe("Moonlight");
        expect(describeWindowSubject("/home/author/games/Moonlight")).toBe("Moonlight");
    });

    it("has no name for a window that holds no project", () => {
        expect(describeWindowSubject(undefined)).toBeNull();
        expect(describeWindowSubject("")).toBeNull();
        expect(describeWindowSubject(42)).toBeNull();
    });
});
