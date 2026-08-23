import { describe, expect, it } from "vitest";
import {
    TRANSLATION_EXCHANGE_FORMATS,
    detectTranslationExchangeFormat,
    normalizeExchangeStatus,
    parseTranslationExchange,
    serializeTranslationExchange,
    translationExchangeExtensions,
    type TranslationExchangeDocument,
    type TranslationExchangeFormat,
    type TranslationExchangeRow,
} from "./localizationExchange";

const row = (partial: Partial<TranslationExchangeRow>): TranslationExchangeRow => ({
    unitId: "u1",
    context: "",
    source: "",
    target: "",
    status: "",
    note: "",
    ...partial,
});

/** A row of every kind that has ever broken one of the four formats. */
const AWKWARD_ROWS: TranslationExchangeRow[] = [
    row({
        unitId: "t-1",
        context: "第一章 · 爱丽丝",
        source: "He said \"go\", then {0} left.",
        target: "他说\"走\"，然后 {0} 离开了。",
        status: "translated",
        note: "note, with a comma",
    }),
    row({
        unitId: "key:menu.start",
        context: "Named keys",
        source: "Start\nthe game",
        target: "开始\n游戏",
        status: "reviewed",
        note: "multi\nline note",
    }),
    row({ unitId: "char:alice", context: "Characters", source: "Alice", target: "", status: "" }),
    row({ unitId: "ui:title.text", context: "Title screen", source: "New game", target: "新游戏", status: "machine" }),
    row({ unitId: "t-9", context: "", source: "Backslash \\ and tab\there", target: "反斜杠", status: "stale" }),
    // Every shape of Studio's inline vocabulary at once. XLIFF turns these into inline elements and
    // the other three carry them as text, so this row is what proves all four agree on the result.
    row({
        unitId: "t-inline",
        context: "The clubroom",
        source: "So it is ‹1›my turn‹/1›‹2/›, {0}.",
        target: "所以这次‹1›轮到我‹/1›‹2/›，{0}。",
        status: "translated",
    }),
    // Prose that merely contains guillemets, which Swiss French and German set as quotation marks.
    row({ unitId: "t-quotes", context: "", source: "Er sagte ‹leise›.", target: "他轻声说‹是›。", status: "translated" }),
];

const document = (rows: readonly TranslationExchangeRow[]): TranslationExchangeDocument => ({
    sourceLocale: "en",
    targetLocale: "zh-CN",
    projectName: "My Game",
    rows,
});

describe.each(TRANSLATION_EXCHANGE_FORMATS)("%s exchange round-trip", format => {
    it("returns every row unchanged", () => {
        const text = serializeTranslationExchange(format, document(AWKWARD_ROWS));
        const parsed = parseTranslationExchange(format, text);
        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toEqual(AWKWARD_ROWS);
    });

    it("survives an empty row set", () => {
        const text = serializeTranslationExchange(format, document([]));
        expect(parseTranslationExchange(format, text).rows).toEqual([]);
    });

    it("is detected from its own file name", () => {
        const text = serializeTranslationExchange(format, document(AWKWARD_ROWS));
        expect(detectTranslationExchangeFormat(`zh-CN.${format === "xliff" ? "xlf" : format}`, text)).toBe(format);
    });
});

describe("exchange envelope", () => {
    it("prepends a UTF-8 BOM for CSV only, and strips it back off", () => {
        for (const format of TRANSLATION_EXCHANGE_FORMATS) {
            const text = serializeTranslationExchange(format, document(AWKWARD_ROWS));
            expect(text.charCodeAt(0) === 0xfeff).toBe(format === "csv");
            expect(parseTranslationExchange(format, text).rows).toEqual(AWKWARD_ROWS);
        }
    });

    it("carries the language tags in every format that has a place for them", () => {
        for (const format of TRANSLATION_EXCHANGE_FORMATS) {
            const parsed = parseTranslationExchange(format, serializeTranslationExchange(format, document(AWKWARD_ROWS)));
            if (format === "csv") {
                expect(parsed.targetLocale).toBeUndefined();
                continue;
            }
            expect([format, parsed.sourceLocale, parsed.targetLocale]).toEqual([format, "en", "zh-CN"]);
        }
    });

    it("normalizes an unknown status to untranslated", () => {
        expect(normalizeExchangeStatus("REVIEWED")).toBe("reviewed");
        expect(normalizeExchangeStatus("done")).toBe("");
        expect(normalizeExchangeStatus(undefined)).toBe("");
    });

    it("offers every accepted extension to the file dialog", () => {
        expect(translationExchangeExtensions()).toEqual(["csv", "xlf", "xliff", "po", "pot", "json"]);
    });
});

describe("format detection", () => {
    it("prefers the extension", () => {
        expect(detectTranslationExchangeFormat("a/b/zh.XLIFF")).toBe("xliff");
        expect(detectTranslationExchangeFormat("C:\\exports\\zh.pot")).toBe("po");
        expect(detectTranslationExchangeFormat("zh.json")).toBe("json");
    });

    it("falls back to the content when the extension says nothing", () => {
        expect(detectTranslationExchangeFormat("hand-back.txt", "{\"units\":{}}")).toBe("json");
        expect(detectTranslationExchangeFormat("hand-back.txt", "<?xml version=\"1.0\"?><xliff/>")).toBe("xliff");
        expect(detectTranslationExchangeFormat("hand-back.txt", "msgid \"\"\nmsgstr \"\"\n")).toBe("po");
        expect(detectTranslationExchangeFormat("hand-back.txt", "unit_id,target\nt-1,x\n")).toBe("csv");
        expect(detectTranslationExchangeFormat("hand-back.txt", "just prose")).toBeNull();
    });

    it("says nothing about a file it was given no content for", () => {
        expect(detectTranslationExchangeFormat("hand-back.txt")).toBeNull();
    });
});

describe("xliff specifics", () => {
    const parse = (text: string) => parseTranslationExchange("xliff", text);

    it("writes 1.2 with the unit id on both id and resname", () => {
        const text = serializeTranslationExchange("xliff", document([row({ unitId: "t-1", source: "Hi", target: "嗨", status: "translated" })]));
        expect(text).toContain("<xliff xmlns=\"urn:oasis:names:tc:xliff:document:1.2\" version=\"1.2\">");
        expect(text).toContain("<trans-unit id=\"t-1\" resname=\"t-1\" xml:space=\"preserve\">");
        expect(text).toContain("<target state=\"translated\">嗨</target>");
    });

    it("maps the states a CAT tool writes back", () => {
        const parsed = parse(`<?xml version="1.0"?>
<xliff version="1.2"><file source-language="en" target-language="ja"><body>
  <trans-unit id="a"><source>A</source><target state="final">あ</target></trans-unit>
  <trans-unit id="b"><source>B</source><target state="needs-review-translation">い</target></trans-unit>
  <trans-unit id="c"><source>C</source><target state="needs-adaptation">う</target></trans-unit>
  <trans-unit id="d"><source>D</source><target>え</target></trans-unit>
  <trans-unit id="e"><source>E</source><target state="new"></target></trans-unit>
</body></file></xliff>`);
        expect(parsed.rows.map(unit => `${unit.unitId}:${unit.status}`))
            .toEqual(["a:reviewed", "b:machine", "c:machine", "d:translated", "e:"]);
        expect(parsed.targetLocale).toBe("ja");
    });

    it("reads XLIFF 2.0, joining a re-segmented unit", () => {
        const parsed = parse(`<?xml version="1.0"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="fr">
 <file id="f1">
  <unit id="t-1">
   <notes><note category="context">Scene 1</note><note>from the translator</note></notes>
   <segment state="translated"><source>Hello, </source><target>Bonjour, </target></segment>
   <segment state="translated"><source>world.</source><target>le monde.</target></segment>
  </unit>
 </file>
</xliff>`);
        expect(parsed.rows).toEqual([row({
            unitId: "t-1",
            context: "Scene 1",
            source: "Hello, world.",
            target: "Bonjour, le monde.",
            status: "translated",
            note: "from the translator",
        })]);
        expect([parsed.sourceLocale, parsed.targetLocale]).toEqual(["en", "fr"]);
    });

    it("writes Studio's inline vocabulary as inline elements, and reads it back", () => {
        const text = serializeTranslationExchange("xliff", document([row({
            unitId: "t-1",
            source: "So it is ‹1›my turn‹/1›‹2/›, {0}.",
            target: "所以这次‹1›轮到我‹/1›‹2/›，{0}。",
            status: "translated",
        })]));
        expect(text).toContain("<source>So it is <g id=\"r1\">my turn</g><x id=\"r2\" equiv-text=\"‹2/›\"/>, <x id=\"v0\" equiv-text=\"{0}\"/>.</source>");
        expect(parse(text).rows[0]).toMatchObject({
            source: "So it is ‹1›my turn‹/1›‹2/›, {0}.",
            target: "所以这次‹1›轮到我‹/1›‹2/›，{0}。",
        });
    });

    it("closes a span the translator left open, rather than writing an unbalanced document", () => {
        const text = serializeTranslationExchange("xliff", document([row({ unitId: "t-1", target: "半途‹1›而废", status: "translated" })]));
        expect(text).toContain("<target state=\"translated\">半途<g id=\"r1\">而废</g></target>");
        // A stray closing tag is dropped for the same reason: the document has to stay well-formed.
        const stray = serializeTranslationExchange("xliff", document([row({ unitId: "t-1", target: "无中‹/3›生有", status: "translated" })]));
        expect(stray).toContain("<target state=\"translated\">无中生有</target>");
    });

    it("reads back what a tool did to our tags, whatever it did", () => {
        const parsed = parse(`<xliff version="1.2"><file><body>
  <trans-unit id="paired"><target><g id="r1">wrapped</g></target></trans-unit>
  <trans-unit id="split"><target><sc id="r1"/>started<ec startRef="r1"/> done</target></trans-unit>
  <trans-unit id="annotated"><target><mrk mtype="term"><g id="r2">term</g></mrk></target></trans-unit>
  <trans-unit id="recoded"><target><bpt id="1">&lt;g id="r1"&gt;</bpt>words<ept id="1">&lt;/g&gt;</ept></target></trans-unit>
  <trans-unit id="theirs"><target>plain <x id="tool-1"/><ph id="p1">&lt;br/&gt;</ph>text</target></trans-unit>
</body></file></xliff>`);
        const targets = Object.fromEntries(parsed.rows.map(entry => [entry.unitId, entry.target]));
        // Ours, however the tool chose to spell it.
        expect(targets.paired).toBe("‹1›wrapped‹/1›");
        expect(targets.split).toBe("‹1›started‹/1› done");
        // An annotation the tool wrapped around our tag: walked into, so both survive.
        expect(targets.annotated).toBe("‹2›term‹/2›");
        // A tool that re-encoded our tag as native code: the tag is gone, every word is not.
        expect(targets.recoded).toBe("words");
        // Codes that were never ours contribute nothing, and the words around them stay.
        expect(targets.theirs).toBe("plain text");
    });

    it("reads XLIFF 2.0 inline codes", () => {
        const parsed = parse(`<xliff version="2.0" srcLang="en" trgLang="ja"><file>
  <unit id="t-1"><segment><source>a</source><target>私が<pc id="r1">去年</pc><ph id="r2"/>決めた<ph id="v0"/>。</target></segment></unit>
</file></xliff>`);
        expect(parsed.rows[0].target).toBe("私が‹1›去年‹/1›‹2/›決めた{0}。");
    });

    it("flattens inline markup a CAT tool introduced", () => {
        const parsed = parse(`<xliff version="1.2"><file><body>
  <trans-unit id="t-1"><source>Hi <g id="1">there</g>!</source><target>你好<g id="1">呀</g>！</target></trans-unit>
</body></file></xliff>`);
        expect(parsed.rows[0].source).toBe("Hi there!");
        expect(parsed.rows[0].target).toBe("你好呀！");
    });

    it("undoes a pretty-printer's indentation without touching real whitespace", () => {
        const parsed = parse(`<xliff version="1.2"><file><body>
  <trans-unit id="t-1">
    <source>
      Indented by the tool
    </source>
    <target> leading space is mine </target>
  </trans-unit>
</body></file></xliff>`);
        expect(parsed.rows[0].source).toBe("Indented by the tool");
        expect(parsed.rows[0].target).toBe(" leading space is mine ");
    });

    it("refuses a file that is not XLIFF, and says what it got", () => {
        expect(parse("<html><body>nope</body></html>").errors).toEqual(["Not an XLIFF file: the root element is <html>"]);
        expect(parse("not xml at all").errors).toEqual(["Not a readable XML file"]);
        expect(parse("<xliff version=\"1.2\"></xliff>").errors).toEqual(["This XLIFF file has no translation units"]);
    });
});

describe("po specifics", () => {
    const parse = (text: string) => parseTranslationExchange("po", text);

    it("writes the unit id as msgctxt and flags unfinished states fuzzy", () => {
        const text = serializeTranslationExchange("po", document([
            row({ unitId: "t-1", source: "Hi", target: "嗨", status: "machine", context: "Scene 1" }),
        ]));
        expect(text).toContain("msgctxt \"t-1\"");
        expect(text).toContain("#, fuzzy");
        expect(text).toContain("#. Scene 1");
        expect(text).toContain("\"Language: zh-CN\\n\"");
    });

    it("writes paragraphs in the multi-line form PO editors display", () => {
        const text = serializeTranslationExchange("po", document([row({ unitId: "t-1", source: "one\ntwo", target: "" })]));
        expect(text).toContain("msgid \"\"\n\"one\\n\"\n\"two\"\n");
    });

    it("reads a file from another tool: no status comment, fuzzy, obsolete entries", () => {
        const parsed = parse(`# Translation of the game
# Copyright holder, 2026.
#
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: de\\n"

#. Scene 1
#, fuzzy
msgctxt "t-1"
msgid "Hello"
msgstr "Hallo"

msgctxt "t-2"
msgid "Bye"
msgstr "Tschüss"

#~ msgctxt "t-gone"
#~ msgid "Removed"
#~ msgstr "Entfernt"
`);
        expect(parsed.errors).toEqual([]);
        expect(parsed.targetLocale).toBe("de");
        expect(parsed.rows).toEqual([
            row({ unitId: "t-1", context: "Scene 1", source: "Hello", target: "Hallo", status: "machine" }),
            row({ unitId: "t-2", source: "Bye", target: "Tschüss", status: "translated" }),
        ]);
    });

    it("takes the first form of a plural entry and drops the rest", () => {
        const parsed = parse(`msgctxt "t-1"
msgid "one file"
msgid_plural "%d files"
msgstr[0] "eine Datei"
msgstr[1] "%d Dateien"
`);
        expect(parsed.rows).toEqual([row({ unitId: "t-1", source: "one file", target: "eine Datei", status: "translated" })]);
    });

    it("keeps an entry whose translation is still empty", () => {
        const parsed = parse("msgctxt \"t-1\"\nmsgid \"Hello\"\nmsgstr \"\"\n");
        expect(parsed.rows).toEqual([row({ unitId: "t-1", source: "Hello", target: "", status: "" })]);
    });
});

describe("json specifics", () => {
    const parse = (text: string) => parseTranslationExchange("json", text);

    it("reads the shape Studio wrote", () => {
        const text = serializeTranslationExchange("json", document([row({ unitId: "t-1", source: "Hi", target: "嗨", status: "translated" })]));
        expect(JSON.parse(text)).toMatchObject({ format: "narraleaf-translation", sourceLocale: "en", targetLocale: "zh-CN", project: "My Game" });
        expect(parse(text).rows).toEqual([row({ unitId: "t-1", source: "Hi", target: "嗨", status: "translated" })]);
    });

    it("reads a bare id-to-translation map", () => {
        expect(parse("{\"t-1\": \"嗨\", \"key:menu.start\": \"开始\"}").rows).toEqual([
            row({ unitId: "t-1", target: "嗨" }),
            row({ unitId: "key:menu.start", target: "开始" }),
        ]);
    });

    it("reads a list of rows under any of the usual id spellings", () => {
        const parsed = parse("[{\"unit_id\": \"t-1\", \"translation\": \"嗨\"}, {\"id\": \"t-2\", \"target\": \"再见\"}]");
        expect(parsed.rows).toEqual([row({ unitId: "t-1", target: "嗨" }), row({ unitId: "t-2", target: "再见" })]);
    });

    it("reads targets-only units and ignores the metadata keys around them", () => {
        const parsed = parse("{\"sourceLocale\": \"en\", \"targetLocale\": \"ja\", \"units\": {\"t-1\": \"やあ\"}}");
        expect(parsed.rows).toEqual([row({ unitId: "t-1", target: "やあ" })]);
        expect(parsed.targetLocale).toBe("ja");
    });

    it("reports a file with nothing translatable in it", () => {
        expect(parse("{\"version\": 1}").errors).toEqual(["This JSON file holds no translation units"]);
        expect(parse("nope").errors[0]).toContain("Not a readable JSON file");
    });
});
