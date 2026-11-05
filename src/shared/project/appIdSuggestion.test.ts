import { describe, expect, it } from "vitest";
import {
    appIdCollisionKey,
    authorNameForAppId,
    isValidNewAppId,
    prefixAppIdWithAuthor,
    uniqueAppId,
} from "./appIdSuggestion";

/**
 * The app ID a new project is offered.
 *
 * It is permanent once the project exists and it is the released game's identity on a player's
 * machine, so the suggestion is where two games are kept from sharing one: other authors' games by
 * the author's name in front, this machine's other projects by a number on the end.
 */
describe("when two projects have one app ID", () => {
    it("compares the ID a build ships with, not the stored text", () => {
        expect(appIdCollisionKey("my-game", "Mine")).toBe(appIdCollisionKey("com.narraleaf.games.my-game", "Other"));
        expect(appIdCollisionKey("My-Game", "Mine")).toBe(appIdCollisionKey("my-game", "Mine"));
        expect(appIdCollisionKey("com.studio.game", "A")).not.toBe(appIdCollisionKey("com.studio.game2", "A"));
        // A project from before IDs were asked for ships under its name's slug.
        expect(appIdCollisionKey("", "Ghost Story")).toBe(appIdCollisionKey("ghost-story", "Anything"));
    });
});

describe("the author's name in front of a suggestion", () => {
    it("leads the game's slug with the author's", () => {
        expect(prefixAppIdWithAuthor("my-game", "leaf-studio")).toBe("leaf-studio-my-game");
    });

    it("adds nothing without an author, twice over, or to a reverse-domain ID", () => {
        expect(prefixAppIdWithAuthor("my-game", "")).toBe("my-game");
        expect(prefixAppIdWithAuthor("leaf-days", "leaf")).toBe("leaf-days");
        expect(prefixAppIdWithAuthor("leaf", "leaf")).toBe("leaf");
        expect(prefixAppIdWithAuthor("com.studio.game", "leaf")).toBe("com.studio.game");
        expect(prefixAppIdWithAuthor("", "leaf")).toBe("");
    });

    it("keeps a long author line from crowding out the game", () => {
        const id = prefixAppIdWithAuthor("my-game", "hangzhou-leaf-interactive-entertainment-co-ltd");
        expect(id.endsWith("-my-game")).toBe(true);
        expect(id.length).toBeLessThanOrEqual(50);
        expect(isValidNewAppId(id)).toBe(true);
    });

    it("reads the name out of an author line holding an e-mail address", () => {
        expect(authorNameForAppId("Leaf Studio")).toBe("Leaf Studio");
        expect(authorNameForAppId("Alice <alice@example.com>")).toBe("Alice");
        expect(authorNameForAppId("alice@example.com")).toBe("alice");
        expect(authorNameForAppId("  ")).toBe("");
    });
});

describe("a suggestion no other project here uses", () => {
    it("is the base when nothing has it, and numbered when something does", () => {
        const taken = new Set(["my-game", "my-game-2"]);
        expect(uniqueAppId("other", id => taken.has(id))).toBe("other");
        expect(uniqueAppId("my-game", id => taken.has(id))).toBe("my-game-3");
    });

    it("numbers a reverse-domain ID's last part, which keeps it one", () => {
        const id = uniqueAppId("com.studio.game", value => value === "com.studio.game");
        expect(id).toBe("com.studio.game-2");
        expect(isValidNewAppId(id)).toBe(true);
    });

    it("stays within the length a slug may have", () => {
        const base = "a".repeat(50);
        const id = uniqueAppId(base, value => value === base);
        expect(id.length).toBeLessThanOrEqual(50);
        expect(id.endsWith("-2")).toBe(true);
    });

    it("leaves an empty suggestion empty, for the author to fill", () => {
        expect(uniqueAppId("", () => true)).toBe("");
    });
});
