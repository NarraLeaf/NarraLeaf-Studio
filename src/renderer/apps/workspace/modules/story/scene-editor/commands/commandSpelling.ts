import type { StoryCommandSpelling } from "@shared/story/migrateStoryDocument";
import { findParam, matchEnumOption, paramTypes } from "../storyCommandGrammar";
import { localizedEnumValue } from "./localizedEnums";
import { localizedParamKey } from "./localizedParams";
import { localizedUnit } from "./localizedUnits";
import { getDefById, localizedCommandToken } from "./registry";

/**
 * The author's command language as the migration ladder's note writer asks for it.
 *
 * Every word comes from the table a committed row is printed from - the verb from
 * {@link localizedCommandToken}, keys from {@link localizedParamKey}, enum words from
 * {@link localizedEnumValue}, units from {@link localizedUnit} - so a note standing in for a row the
 * ladder could not carry over reads like the rows around it: `/跳转进度 cutscene 1秒` in Chinese,
 * `/seek cutscene 1s` in English. A word the vocabulary does not know is written as given.
 *
 * Read at the moment it is called, so a migration takes whatever command language is in effect when
 * the document is opened.
 */
export function storyCommandSpelling(): StoryCommandSpelling {
    return {
        command(commandId, token) {
            // Where the command language has no word of its own the line keeps the token it was
            // typed with - `/video` stays `/video` in English rather than becoming `/play`.
            const def = getDefById(commandId);
            const localized = def ? localizedCommandToken(def) : def;
            return localized && localized !== def?.token ? localized : token;
        },
        param(commandId, name) {
            const def = getDefById(commandId);
            const param = def ? findParam(def, name) : null;
            return def && param ? localizedParamKey(def, param) : name;
        },
        enumValue(commandId, name, value) {
            const def = getDefById(commandId);
            const param = def ? findParam(def, name) : null;
            for (const type of param ? paramTypes(param) : []) {
                if (type.kind !== "enum") {
                    continue;
                }
                const option = matchEnumOption(type, value);
                if (option) {
                    return localizedEnumValue(type, option);
                }
            }
            return value;
        },
        unit: unit => localizedUnit(unit),
    };
}
