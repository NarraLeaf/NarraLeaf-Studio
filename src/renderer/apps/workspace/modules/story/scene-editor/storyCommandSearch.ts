import { listCommandDefs } from "./commands/registry";
import type { PaletteActionCommand } from "./storyActionCommands";
import { STORY_COMMAND_PINYIN } from "./storyCommandPinyin.generated";

/**
 * Fuzzy, multilingual matching for the command-name menu - shared by the `/` inline creator and the
 * sidebar palette so the two never disagree about what a query finds.
 *
 * The gap it closes: a palette command's own fields never carry the short token the parser accepts
 * (`/bg`, `/show`, `/se`), so filtering on label/id/detail alone made intuitive input match nothing
 * even though pressing Enter resolved the line. This bridges the grammar tokens in, ranks precise hits
 * above loose ones, and falls all the way back to a subsequence match so an abbreviation or a small
 * typo still finds its command. Localized labels are matched as given (callers pass already-translated
 * commands), so `/背景` lands on `bg` without the grammar carrying any locale data.
 */

/** English tokens the parser accepts for a command id - its canonical token plus every alias. */
const KEYWORDS_BY_COMMAND_ID: ReadonlyMap<string, readonly string[]> = new Map(
    listCommandDefs().map(def => [
        def.commandId.toLowerCase(),
        [def.token, ...(def.aliases ?? [])].map(keyword => keyword.toLowerCase()),
    ]),
);

/** Are all of `needle`'s characters present in `haystack`, in order? Both must be lower-cased already. */
function isSubsequence(needle: string, haystack: string): boolean {
    let index = 0;
    for (const char of haystack) {
        if (index < needle.length && needle[index] === char) {
            index += 1;
        }
    }
    return index === needle.length;
}

/**
 * How well a command answers a query - higher is better, or null for no match. Tiers, in order: an
 * exact keyword (including its `/`-spelled form, so `//` → Note and `/bg` both land), a keyword prefix,
 * a display prefix, a keyword substring, a display substring, then a last-resort subsequence.
 *
 * The `/`-spelled forms sit in the exact tier only, on purpose: a bare `/` must not substring-match
 * every `/token` and drag the whole palette in behind Note.
 *
 * A zh-labelled command also carries its toneless pinyin as keywords (full syllables + first-letter
 * initials, from the checked-in static table), so a Latin-alphabet author reaches "背景" by typing
 * "beijing" or "bj". They ride the same keyword tiers as the English tokens; the Chinese label itself
 * is matched separately by the parser's localized-token table, so both spellings resolve.
 */
function scoreCommand(command: PaletteActionCommand, query: string): number | null {
    const pinyin = STORY_COMMAND_PINYIN[command.id];
    const keywords = new Set<string>([
        ...(KEYWORDS_BY_COMMAND_ID.get(command.id.toLowerCase()) ?? []),
        ...(command.aliases ?? []).map(alias => alias.toLowerCase()),
        ...(pinyin ? [pinyin.full, pinyin.initials] : []),
    ]);
    const slashed = new Set([...keywords].map(keyword => (keyword.startsWith("/") ? keyword : `/${keyword}`)));
    const texts = [command.label, command.id, command.detail, command.nlrCapability ?? ""].map(text => text.toLowerCase());

    if (keywords.has(query) || slashed.has(query)) {
        return 100;
    }
    if ([...keywords].some(keyword => keyword.startsWith(query))) {
        return 85;
    }
    if (texts.some(text => text.startsWith(query))) {
        return 75;
    }
    if ([...keywords].some(keyword => keyword.includes(query))) {
        return 65;
    }
    if (texts.some(text => text.includes(query))) {
        return 55;
    }
    if ([...keywords, ...texts].some(text => isSubsequence(query, text))) {
        return 40;
    }
    return null;
}

/**
 * Commands matching `query`, most relevant first. The input order (the palette's own grouping) is kept
 * for ties and returned as-is for an empty query. Pass commands already localized - the label is
 * matched as given, which is what lets a translated label answer a query in the author's language.
 */
export function searchActionCommands(commands: readonly PaletteActionCommand[], rawQuery: string): PaletteActionCommand[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return [...commands];
    }
    return commands
        .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
        .filter((entry): entry is { command: PaletteActionCommand; index: number; score: number } => entry.score !== null)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(entry => entry.command);
}
