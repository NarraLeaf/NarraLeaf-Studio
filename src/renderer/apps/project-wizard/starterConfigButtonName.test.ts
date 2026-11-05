/**
 * The title screen's button to the settings page carries the page's own name.
 *
 * Three ways reach that page - the title screen's button, the quick menu's, and the rail on the
 * pages beside it - and the page names itself in its heading. They are four keys, and the English
 * template once had the title button say Settings while the page and the other two said Config: an
 * author following the button found a page called something else. In every language each tree is
 * written in, and in every translation it carries, the four read the same; a translation of the
 * button is also current against the word it translates, so none of them shows as stale.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashSourceText } from "@shared/utils/localizationText";

const ROOT = path.join(process.cwd(), "resources/templates/skeleton");
const TREES = ["content", "content.zh", "content.ja"];
/** The title button, then the three that must read as it does. */
const BUTTON = "menu.settings";
const SAME_AS_BUTTON = ["config.title", "quickMenu.config", "nav.config"];

function read<T>(tree: string, file: string): T {
    return JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor/localization", file), "utf-8")) as T;
}

type Keys = { keys: Record<string, { sourceText: string }> };
type Translation = { units: Record<string, { sourceHash: string; target: string }> };

describe.each(TREES)("the skeleton's settings button in %s", tree => {
    const keys = read<Keys>(tree, "keys.json").keys;
    const translations = fs.readdirSync(path.join(ROOT, tree, "editor/localization"))
        .filter(file => file !== "keys.json" && file.endsWith(".json"));

    it("reads as the settings page names itself, and as the other two ways there", () => {
        for (const key of SAME_AS_BUTTON) {
            expect(keys[key]?.sourceText, key).toBe(keys[BUTTON].sourceText);
        }
    });

    it.each(translations)("reads the same in %s, translated against the current word", file => {
        const units = read<Translation>(tree, file).units;
        const button = units[`key:${BUTTON}`];
        expect(button.sourceHash).toBe(hashSourceText(keys[BUTTON].sourceText));
        for (const key of SAME_AS_BUTTON) {
            expect(units[`key:${key}`]?.target, key).toBe(button.target);
        }
    });
});
