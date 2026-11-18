import { describe, expect, it } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { activeSignIn } from "./TeamAccountMenu";

/**
 * Which account a window on no Team project shows, with more than one held.
 *
 * The newest act wins: a pick in the account menu holds until a server is signed in to after it,
 * because an account just added is the one the author expects to see.
 */

function held(remoteOrigin: string, signedInAt: number): VcsServerSession {
    return {
        authUrl: `https://${remoteOrigin.slice("lore://".length)}`,
        remoteOrigin,
        account: {
            userId: remoteOrigin,
            displayName: remoteOrigin,
            username: remoteOrigin,
            email: "",
            identity: remoteOrigin,
            expiresAt: 0,
        },
        signedInAt,
    };
}

const A = "lore://a.example.lan:41337";
const B = "lore://b.example.lan:41337";

describe("the account a window on no project shows", () => {
    it("is the latest sign-in when nothing was picked", () => {
        expect(activeSignIn([held(A, 10), held(B, 20)], null)).toBe(B);
    });

    it("is the picked one once the author picks it", () => {
        expect(activeSignIn([held(A, 10), held(B, 20)], { remoteOrigin: A, chosenAt: 30 })).toBe(A);
    });

    it("gives way to a server signed in to after the pick", () => {
        expect(activeSignIn([held(A, 10), held(B, 40)], { remoteOrigin: A, chosenAt: 30 })).toBe(B);
    });

    it("falls back to the latest sign-in when the picked server is no longer held", () => {
        expect(activeSignIn([held(B, 20)], { remoteOrigin: A, chosenAt: 30 })).toBe(B);
    });

    it("is nothing with nothing held", () => {
        expect(activeSignIn([], { remoteOrigin: A, chosenAt: 30 })).toBeNull();
    });
});
