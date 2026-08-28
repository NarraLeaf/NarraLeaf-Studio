import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_BYTES, readTeamFrame } from "./socket";

/**
 * What a session's socket will read off the wire.
 *
 * The half worth guarding without a server is the frame reader: what it admits, what it
 * refuses, and above all the size it draws the line at. That line was set from the figure
 * a Team server accepts *from* a client, which is a suggestion and its frame; applied to
 * what arrives it refused an ordinary page of a project's overlay and ended the session
 * over it - then ended it again on the next read after the reconnect.
 *
 * So the ceiling is asserted against the contract rather than against a number repeated
 * here. A test that only said "two mebibytes" would pass just as happily on the day
 * somebody put the small figure back.
 */

interface Contract {
    limits: Record<string, number>;
}

const contract = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "../../../../../shared/types/teamContract.json"),
        "utf-8",
    ),
) as Contract;

/** One unmasked frame, the way a server writes them. */
function frame(payload: Buffer, opcode = 0x1, final = true): Buffer {
    const first = Buffer.from([(final ? 0b1000_0000 : 0) | opcode]);
    if (payload.length < 126) {
        return Buffer.concat([first, Buffer.from([payload.length]), payload]);
    }
    if (payload.length < 0x1_0000) {
        const header = Buffer.alloc(3);
        header[0] = 126;
        header.writeUInt16BE(payload.length, 1);
        return Buffer.concat([first, header, payload]);
    }
    const header = Buffer.alloc(9);
    header[0] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 1);
    return Buffer.concat([first, header, payload]);
}

/** A header that claims a length without any of the payload behind it. */
function claims(length: number): Buffer {
    const header = Buffer.alloc(10);
    header[0] = 0b1000_0001;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
    return header;
}

describe("the ceiling a session reads answers at", () => {
    it("is the most the contract says a server sends in one answer", () => {
        expect(MAX_MESSAGE_BYTES).toBe(contract.limits["answerBytes"]);
    });

    it("is far above what a client sends, which is what it used to be set to", () => {
        // The figure that was here. Named so that putting it back is a failing test rather
        // than a session that dies on the first project with a few long review notes.
        expect(MAX_MESSAGE_BYTES).toBeGreaterThan(128 * 1024);
    });

    it("reads an answer larger than a client is ever allowed to send", () => {
        const body = Buffer.from("x".repeat(200 * 1024), "utf-8");
        const read = readTeamFrame(frame(body), MAX_MESSAGE_BYTES);
        expect(read.kind).toBe("frame");
        if (read.kind !== "frame") return;
        expect(read.payload.length).toBe(body.length);
        expect(read.rest.length).toBe(0);
    });

    it("refuses a payload past the ceiling rather than holding it", () => {
        // Asserted at a small ceiling as well as the real one, because a length stated in
        // sixteen bits is always inside two mebibytes: this is the check that catches a
        // frame whose declared size is plainly there, and the real ceiling never reaches it.
        expect(readTeamFrame(frame(Buffer.alloc(300)), 128)).toEqual({
            kind: "refused",
            detail: "that server sent more than this will hold",
        });
        expect(readTeamFrame(frame(Buffer.alloc(MAX_MESSAGE_BYTES + 1)), MAX_MESSAGE_BYTES).kind)
            .toBe("refused");
    });

    it("refuses a declared length past the ceiling before waiting for any of it", () => {
        // Only the header is here. A peer announcing four gigabytes must be turned away on
        // what it said, not after this has waited for the bytes to arrive.
        const read = readTeamFrame(claims(4 * 1024 * 1024 * 1024), MAX_MESSAGE_BYTES);
        expect(read.kind).toBe("refused");
    });
});

describe("reading one frame off a buffer", () => {
    it("says nothing is here yet rather than guessing at a part of a frame", () => {
        expect(readTeamFrame(Buffer.alloc(1), MAX_MESSAGE_BYTES).kind).toBe("incomplete");
        // A two-byte header claiming an extended length, with none of it behind it.
        expect(readTeamFrame(Buffer.from([0b1000_0001, 126]), MAX_MESSAGE_BYTES).kind)
            .toBe("incomplete");
        // A whole header, and one byte short of the payload it names.
        const body = Buffer.from("hello", "utf-8");
        const short = frame(body).subarray(0, 2 + body.length - 1);
        expect(readTeamFrame(short, MAX_MESSAGE_BYTES).kind).toBe("incomplete");
    });

    it("hands back what followed, so a buffer holding two frames reads as two", () => {
        const together = Buffer.concat([
            frame(Buffer.from("first", "utf-8")),
            frame(Buffer.from("second", "utf-8")),
        ]);
        const one = readTeamFrame(together, MAX_MESSAGE_BYTES);
        expect(one.kind).toBe("frame");
        if (one.kind !== "frame") return;
        expect(one.payload.toString("utf-8")).toBe("first");

        const two = readTeamFrame(one.rest, MAX_MESSAGE_BYTES);
        expect(two.kind).toBe("frame");
        if (two.kind !== "frame") return;
        expect(two.payload.toString("utf-8")).toBe("second");
        expect(two.rest.length).toBe(0);
    });

    it("carries the opcode and whether the message ends there", () => {
        const opening = readTeamFrame(frame(Buffer.from("half", "utf-8"), 0x1, false), MAX_MESSAGE_BYTES);
        expect(opening.kind === "frame" && opening.final).toBe(false);
        expect(opening.kind === "frame" && opening.opcode).toBe(0x1);

        const closing = readTeamFrame(frame(Buffer.alloc(0), 0x8), MAX_MESSAGE_BYTES);
        expect(closing.kind === "frame" && closing.opcode).toBe(0x8);
    });

    it("refuses a masked frame rather than unmasking one out of politeness", () => {
        const masked = Buffer.from([0b1000_0001, 0b1000_0000 | 1, 0, 0, 0, 0, 0x41]);
        expect(readTeamFrame(masked, MAX_MESSAGE_BYTES)).toEqual({
            kind: "refused",
            detail: "that server sent a frame this cannot read",
        });
    });

    it("refuses a frame with a reserved bit set", () => {
        // Reserved bits mean an extension that was never negotiated, so what follows is
        // not a payload this can read.
        expect(readTeamFrame(Buffer.from([0b1100_0001, 1, 0x41]), MAX_MESSAGE_BYTES).kind)
            .toBe("refused");
    });
});
