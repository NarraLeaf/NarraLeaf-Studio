import { describe, expect, it } from "vitest";
import { convertBinaryManifestToProto } from "./axmlProto";
import { patchBinaryManifest } from "./axml";
import { buildProtoManifestFixture } from "./aabFixtures";
import { decodeMessage, has, messageAt, repeatedAt, stringAt, summarizeXmlNode, uintAt } from "./protobufTestReader";

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

function summarize(options?: Parameters<typeof buildProtoManifestFixture>[0]) {
    return summarizeXmlNode(convertBinaryManifestToProto(buildProtoManifestFixture(options)));
}

describe("convertBinaryManifestToProto", () => {
    it("reproduces the document's structure, attributes and values", () => {
        expect(summarize()).toEqual({
            name: "manifest",
            namespaceUri: "",
            namespaces: [{ prefix: "android", uri: ANDROID_NS }],
            attributes: [
                { namespaceUri: "", name: "package", value: "com.narraleaf.shell.placeholder", resourceId: "0x00000000" },
                { namespaceUri: ANDROID_NS, name: "versionCode", value: "", resourceId: "0x0101021b", item: "int:1" },
                { namespaceUri: ANDROID_NS, name: "versionName", value: "0.0.0", resourceId: "0x0101021c" },
            ],
            children: [{
                name: "application",
                namespaceUri: "",
                namespaces: [],
                attributes: [
                    { namespaceUri: ANDROID_NS, name: "label", value: "NarraLeaf Shell", resourceId: "0x01010001" },
                    { namespaceUri: ANDROID_NS, name: "theme", value: "", resourceId: "0x01010000", item: "ref:0x7f020000" },
                ],
                children: [{
                    name: "activity",
                    namespaceUri: "",
                    namespaces: [],
                    attributes: [
                        {
                            namespaceUri: ANDROID_NS,
                            name: "name",
                            value: "com.narraleaf.shell.MainActivity",
                            resourceId: "0x01010003",
                        },
                        { namespaceUri: ANDROID_NS, name: "exported", value: "", resourceId: "0x01010010", item: "bool:true" },
                    ],
                    children: [],
                }],
            }],
        });
    });

    it("leaves string attributes uncompiled and typed attributes untexted", () => {
        // aapt2's own rule, and the reason our output and aapt2's agree byte
        // for byte on the real template: a compiled String item on every label
        // would be a defensible encoding that nothing else produces.
        const root = summarize() as Extract<ReturnType<typeof summarize>, { name: string }>;
        const byName = new Map(root.attributes.map(attribute => [attribute.name, attribute]));
        expect(byName.get("versionName")).not.toHaveProperty("item");
        expect(byName.get("versionName")!.value).toBe("0.0.0");
        expect(byName.get("versionCode")!.item).toBe("int:1");
        expect(byName.get("versionCode")!.value).toBe("");
    });

    it("writes a source position on compiled attributes only", () => {
        // XmlAttribute.source travels with the compiled item in aapt2's
        // serializer; emitting it on string attributes too would diverge.
        const element = messageAt(decodeMessage(convertBinaryManifestToProto(buildProtoManifestFixture())), 1)!;
        const attributes = repeatedAt(element, 4);
        const versionName = attributes.find(attribute => stringAt(attribute, 2) === "versionName")!;
        const versionCode = attributes.find(attribute => stringAt(attribute, 2) === "versionCode")!;
        expect(has(versionName, 4)).toBe(false);
        expect(has(versionCode, 4)).toBe(true);
    });

    it("carries each node's source line", () => {
        const root = decodeMessage(convertBinaryManifestToProto(buildProtoManifestFixture()));
        expect(uintAt(messageAt(root, 3)!, 1)).toBe(2);
        const element = messageAt(root, 1)!;
        expect(uintAt(messageAt(repeatedAt(element, 1)[0], 3)!, 1)).toBe(2);
        const application = repeatedAt(element, 5)[0];
        expect(uintAt(messageAt(application, 3)!, 1)).toBe(5);
    });

    it("keeps text nodes as text children", () => {
        const root = summarize({ withText: true }) as Extract<ReturnType<typeof summarize>, { name: string }>;
        const application = root.children[0] as Extract<ReturnType<typeof summarize>, { name: string }>;
        const activity = application.children[0] as Extract<ReturnType<typeof summarize>, { name: string }>;
        expect(activity.children).toEqual([{ text: "some text" }]);
    });

    it("converts the identity the APK patcher wrote, not the template's", () => {
        // The bundle path runs patchBinaryManifest first, exactly as repackApk
        // does, so this proves the two stages compose rather than each working
        // only in isolation.
        const { data } = patchBinaryManifest(buildProtoManifestFixture(), {
            packageName: "com.acme.mygame",
            label: "My Game",
            versionCode: 1_002_003,
            versionName: "1.2.3",
        });
        const root = summarizeXmlNode(convertBinaryManifestToProto(data)) as
            Extract<ReturnType<typeof summarize>, { name: string }>;
        const byName = new Map(root.attributes.map(attribute => [attribute.name, attribute]));
        expect(byName.get("package")!.value).toBe("com.acme.mygame");
        expect(byName.get("versionName")!.value).toBe("1.2.3");
        expect(byName.get("versionCode")!.item).toBe("int:1002003");
        const application = root.children[0] as Extract<ReturnType<typeof summarize>, { name: string }>;
        expect(application.attributes[0].value).toBe("My Game");
    });

    it("rejects a file that is not binary XML", () => {
        expect(() => convertBinaryManifestToProto(Buffer.from([0x02, 0x00, 0x0c, 0x00, 8, 0, 0, 0])))
            .toThrow(/Not a binary AndroidManifest\.xml/);
    });

    it("rejects a document whose tags do not balance", () => {
        // Dropping the closing <manifest> tag (and the namespace end after it,
        // 24 bytes each) leaves the root element open; a walker that just
        // concatenated whatever it saw would emit a plausible, wrong tree.
        const fixture = buildProtoManifestFixture();
        const truncated = Buffer.from(fixture.subarray(0, fixture.length - 2 * 24));
        truncated.writeUInt32LE(truncated.length, 4);
        expect(() => convertBinaryManifestToProto(truncated)).toThrow(/unclosed element/);
    });
});
