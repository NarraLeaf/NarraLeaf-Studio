import { describe, expect, it } from "vitest";
import { convertArscToProto } from "./arscProto";
import { patchArscPackageName } from "./arsc";
import { ARSC_FIXTURE_STRINGS, buildProtoArscFixture } from "./aabFixtures";
import { decodeMessage, has, messageAt, repeatedAt, summarizeResourceTable } from "./protobufTestReader";

describe("convertArscToProto", () => {
    it("re-expresses the whole table: packages, types, entries and values", () => {
        expect(summarizeResourceTable(convertArscToProto(buildProtoArscFixture()))).toEqual({
            packages: [{
                id: 0x7f,
                name: "com.narraleaf.shell.placeholder",
                types: [
                    {
                        id: 1,
                        name: "drawable",
                        entries: [{
                            id: 0,
                            name: "icon",
                            values: [
                                { config: "density=160", value: "file:res/drawable-mdpi/icon.png:png" },
                                { config: "density=320", value: "file:res/drawable-xhdpi/icon.png:png" },
                            ],
                        }],
                    },
                    {
                        id: 2,
                        name: "string",
                        entries: [{
                            id: 0,
                            name: "greeting",
                            values: [{ config: "locale=en-US", value: "str:Hello" }],
                        }],
                    },
                    {
                        id: 3,
                        name: "style",
                        entries: [{
                            id: 0,
                            name: "AppTheme",
                            values: [{
                                config: "(default)",
                                value: "style(parent=0x01030000){0x01010098=ref:0x7f010000,0x010100d4=bool:true}",
                            }],
                        }],
                    },
                ],
            }],
        });
    });

    it("regroups config-inside-type into config-inside-entry", () => {
        // The one structural difference between the two formats. Two type
        // chunks, each with one entry, must become ONE entry with two config
        // values - not two entries that happen to share a name.
        const table = decodeMessage(convertArscToProto(buildProtoArscFixture()));
        const drawable = repeatedAt(repeatedAt(table, 2)[0], 3)[0];
        const entries = repeatedAt(drawable, 3);
        expect(entries).toHaveLength(1);
        expect(repeatedAt(entries[0], 6)).toHaveLength(2);
    });

    it("writes an entry id of 0 as a present, empty EntryId", () => {
        // An absent entry_id means "no id assigned", which is a different
        // resource from entry 0 - and every first entry in a type is id 0.
        const table = decodeMessage(convertArscToProto(buildProtoArscFixture()));
        const entry = repeatedAt(repeatedAt(repeatedAt(table, 2)[0], 3)[0], 3)[0];
        expect(has(entry, 1)).toBe(true);
        expect(messageAt(entry, 1)!.size).toBe(0);
    });

    it("keeps a `string` resource a String even when its text looks like a path", () => {
        // The file-reference rule is "not the string type AND starts with
        // res/"; dropping the first half turns every path-shaped translation
        // into a dangling file reference.
        const fixture = buildProtoArscFixture();
        const patched = Buffer.from(fixture);
        const marker = patched.indexOf(Buffer.from(ARSC_FIXTURE_STRINGS[2], "utf8"));
        expect(marker).toBeGreaterThan(0);
        // "Hello" (5 bytes) → "res/x" (5 bytes): same length, so nothing moves.
        patched.write("res/x", marker, "utf8");
        const summary = summarizeResourceTable(convertArscToProto(patched));
        expect(summary.packages[0].types[1].entries[0].values[0].value).toBe("str:res/x");
    });

    it("carries the package rename the APK patcher wrote", () => {
        const { data } = patchArscPackageName(buildProtoArscFixture(), "com.acme.mygame");
        expect(summarizeResourceTable(convertArscToProto(data)).packages[0].name).toBe("com.acme.mygame");
    });

    it("refuses to hand a compiled binary XML resource to the bundle", () => {
        // A bundle needs proto XML in that slot; passing the binary form
        // through would produce an archive that only fails later, in
        // bundletool or on a device.
        const fixture = buildProtoArscFixture();
        const patched = Buffer.from(fixture);
        const marker = patched.indexOf(Buffer.from(ARSC_FIXTURE_STRINGS[0], "utf8"));
        expect(marker).toBeGreaterThan(0);
        // Same 26 bytes as "res/drawable-mdpi/icon.png", so the pool's length
        // prefixes and offsets all stay valid.
        patched.write("res/layout/activity_xy.xml", marker, "utf8");
        expect(() => convertArscToProto(patched)).toThrow(/compiled binary XML/);
    });

    it("rejects a file that is not a resource table", () => {
        expect(() => convertArscToProto(Buffer.from([0x03, 0x00, 0x08, 0x00, 8, 0, 0, 0])))
            .toThrow(/Not a resources\.arsc file/);
    });
});
