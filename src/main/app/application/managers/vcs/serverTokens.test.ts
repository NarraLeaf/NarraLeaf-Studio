import { describe, expect, it } from "vitest";

import {
    forgetServerToken,
    recallServerToken,
    rememberServerToken,
    type SecretSealer,
    type TokenStore,
} from "./serverTokens";

/** A global state that is a map, which is all this reads and writes. */
function store(initial: Record<string, string> = {}): TokenStore & { value: unknown } {
    return {
        value: { ...initial },
        get() { return this.value; },
        set(_key, next) { this.value = next; },
    };
}

/**
 * A sealer that is reversible and obviously not encryption.
 *
 * The point of the tests below is what is written and when, not what the OS
 * keyring does with it - and a fake that looked like ciphertext would hide the
 * assertion that matters, which is that the token itself is never the thing
 * stored.
 */
const reversible: SecretSealer = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`, "utf-8"),
    decryptString: (sealed) => sealed.toString("utf-8").replace(/^sealed:/, ""),
};

const unavailable: SecretSealer = {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error("no keyring here"); },
    decryptString: () => { throw new Error("no keyring here"); },
};

const ORIGIN = "lore://studio.example.lan:41337";

describe("the token a server was added with", () => {
    it("comes back for the server it was kept for", () => {
        const state = store();

        expect(rememberServerToken(state, ORIGIN, "a.b.c", reversible)).toBe(true);

        expect(recallServerToken(state, ORIGIN, reversible)).toBe("a.b.c");
    });

    it("is never written as the token itself", () => {
        const state = store();
        rememberServerToken(state, ORIGIN, "a.b.c", reversible);

        // What lands in the global state is a JSON file on disk. The assertion is
        // about that file, so it is made against the whole of what was stored
        // rather than against the field this happens to use today.
        expect(JSON.stringify(state.value)).not.toContain("a.b.c");
    });

    it("keeps nothing on a machine that cannot seal one", () => {
        const state = store();

        expect(rememberServerToken(state, ORIGIN, "a.b.c", unavailable)).toBe(false);

        // Not "kept in the clear as a fallback": a bearer token good for a month,
        // in a file any program running as this user can read, is worse than the
        // feature being unavailable.
        expect(JSON.stringify(state.value)).not.toContain("a.b.c");
        expect(recallServerToken(state, ORIGIN, unavailable)).toBeNull();
    });

    it("is null rather than a throw when the ciphertext cannot be opened", () => {
        const state = store({ [ORIGIN]: "bm90IHNlYWxlZA==" });
        const broken: SecretSealer = {
            isEncryptionAvailable: () => true,
            encryptString: () => Buffer.alloc(0),
            decryptString: () => { throw new Error("wrong key"); },
        };

        // A profile that was moved between machines has ciphertext this OS keyring
        // cannot open. It means the same as having none: ask for the token again.
        expect(recallServerToken(state, ORIGIN, broken)).toBeNull();
    });

    it("is null for a server that was never added", () => {
        expect(recallServerToken(store(), ORIGIN, reversible)).toBeNull();
    });

    it("goes when the server it belongs to is forgotten", () => {
        const state = store();
        rememberServerToken(state, ORIGIN, "a.b.c", reversible);
        rememberServerToken(state, "lore://other.example.lan:41337", "d.e.f", reversible);

        forgetServerToken(state, ORIGIN);

        expect(recallServerToken(state, ORIGIN, reversible)).toBeNull();
        // And only that one: forgetting a server is not signing out of every server.
        expect(recallServerToken(state, "lore://other.example.lan:41337", reversible)).toBe("d.e.f");
    });

    it("survives a stored value that is not the shape it expects", () => {
        const state = store();
        state.value = "not an object at all";

        expect(recallServerToken(state, ORIGIN, reversible)).toBeNull();
        expect(rememberServerToken(state, ORIGIN, "a.b.c", reversible)).toBe(true);
        expect(recallServerToken(state, ORIGIN, reversible)).toBe("a.b.c");
    });
});
