import { describe, expect, it } from "vitest";
import { encodeMessage, ProtoWriter } from "./protobufWriter";
import { bytesAt, boolAt, decodeMessage, floatAt, has, intAt, messageAt, repeatedAt, stringAt, uintAt } from "./protobufTestReader";

describe("ProtoWriter", () => {
    it("encodes varints in the canonical base-128 form", () => {
        // The boundaries are where a hand-rolled varint goes wrong: 127/128 is
        // the one-to-two byte step and 0xffffffff is the widest uint32.
        for (const [value, expected] of [
            [1, "0801"],
            [127, "087f"],
            [128, "088001"],
            [300, "08ac02"],
            [0xffffffff, "08ffffffff0f"],
        ] as const) {
            expect(encodeMessage(writer => writer.uint32(1, value)).toString("hex")).toBe(expected);
        }
    });

    it("omits scalar fields that hold their proto3 default", () => {
        const body = encodeMessage(writer => {
            writer.uint32(1, 0);
            writer.int32(2, 0);
            writer.bool(3, false);
            writer.string(4, "");
            writer.bytes(5, Buffer.alloc(0));
            writer.float(6, 0);
        });
        expect(body).toHaveLength(0);
    });

    it("emits a present submessage even when its body is empty", () => {
        // The distinction the whole .aab conversion rests on: an absent
        // EntryId means "no id assigned", an empty one means id 0.
        const body = encodeMessage(writer => writer.message(1, () => undefined));
        expect(body.toString("hex")).toBe("0a00");
        expect(has(decodeMessage(body), 1)).toBe(true);
    });

    it("nests messages and keeps repeated fields in call order", () => {
        const body = encodeMessage(writer => {
            writer.message(1, inner => inner.string(2, "first"));
            writer.message(1, inner => inner.string(2, "second"));
            writer.message(3, outer => outer.message(1, deep => deep.uint32(4, 7)));
        });
        const decoded = decodeMessage(body);
        expect(repeatedAt(decoded, 1).map(inner => stringAt(inner, 2))).toEqual(["first", "second"]);
        expect(uintAt(messageAt(messageAt(decoded, 3)!, 1)!, 4)).toBe(7);
    });

    it("sign-extends a negative int32 to the full ten-byte varint", () => {
        // A short-form negative would decode as a huge positive on any real
        // reader - and Res_value 0xffffffff really does reach int_decimal.
        const body = encodeMessage(writer => writer.int32(6, -1));
        expect(body.toString("hex")).toBe("30ffffffffffffffffff01");
        expect(intAt(decodeMessage(body), 6)).toBe(-1);
    });

    it("round-trips every encoding the aapt schemas use", () => {
        const body = encodeMessage(writer => {
            writer.uint32(1, 4_000_000_000);
            writer.int32(2, -2_147_483_648);
            writer.bool(3, true);
            writer.float(4, 0.5);
            writer.string(5, "café ☕");
            writer.bytes(6, Buffer.from([0x00, 0xff, 0x10]));
            writer.enumValue(7, 3);
        });
        const decoded = decodeMessage(body);
        expect(uintAt(decoded, 1)).toBe(4_000_000_000);
        expect(intAt(decoded, 2)).toBe(-2_147_483_648);
        expect(boolAt(decoded, 3)).toBe(true);
        expect(floatAt(decoded, 4)).toBe(0.5);
        expect(stringAt(decoded, 5)).toBe("café ☕");
        expect(bytesAt(decoded, 6)).toEqual(Buffer.from([0x00, 0xff, 0x10]));
        expect(uintAt(decoded, 7)).toBe(3);
    });

    it("writes an already-encoded body without re-encoding it", () => {
        const inner = encodeMessage(writer => writer.string(1, "reused"));
        const body = encodeMessage(writer => writer.messageBytes(9, inner));
        expect(stringAt(messageAt(decodeMessage(body), 9)!, 1)).toBe("reused");
    });

    it("rejects values and field numbers the wire format cannot carry", () => {
        expect(() => new ProtoWriter().uint32(1, -1)).toThrow(/not a uint32/);
        expect(() => new ProtoWriter().uint32(1, 0x1_0000_0000)).toThrow(/not a uint32/);
        expect(() => new ProtoWriter().uint32(1, 1.5)).toThrow(/not a uint32/);
        expect(() => new ProtoWriter().int32(1, 0x8000_0000)).toThrow(/not an int32/);
        expect(() => new ProtoWriter().uint32(0, 1)).toThrow(/Invalid protobuf field number/);
        expect(() => new ProtoWriter().uint32(-1, 1)).toThrow(/Invalid protobuf field number/);
    });
});
