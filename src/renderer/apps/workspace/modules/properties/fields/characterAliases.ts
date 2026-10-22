/**
 * The rules for a character's aliases (`profile.nicknames`), apart from the field that edits them.
 *
 * An alias is another spelling a story line's speaker can be written in: `饼姐: …` binds to the
 * character named 责编 when 饼姐 is one of her aliases, and the name box still says 责编. Resolution
 * is exact and goes name first, then alias (`story-cli/lookups.ts`), which is what decides the two
 * conflicts below.
 */

/** What a list of aliases is stored as: trimmed, no blanks, no repeats, never the character's own name. */
export function normalizeCharacterAliases(aliases: readonly string[], ownName: string): string[] {
    const name = ownName.trim();
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of aliases) {
        const alias = raw.trim();
        if (!alias || alias === name || seen.has(alias)) {
            continue;
        }
        seen.add(alias);
        result.push(alias);
    }
    return result;
}

export type CharacterAliasCastMember = {
    id: string;
    name: string;
    nicknames: readonly string[];
};

/**
 * Why one alias would not bind a line to this character, or null when it would.
 *
 * - `ownName`: the alias is the character's own name, so it adds nothing. Only reachable after a
 *   rename, since an add refuses it.
 * - `name`: another character is called that. Names win over aliases, so a line written with it binds
 *   to them.
 * - `alias`: another character has the same alias and nobody is called it, so a line written with it
 *   matches several characters and the story compiler reports `compile.ambiguousSpeaker`.
 */
export type CharacterAliasIssue =
    | { kind: "ownName" }
    | { kind: "name"; names: string[] }
    | { kind: "alias"; names: string[] };

export function characterAliasIssue(
    alias: string,
    self: { id: string; name: string },
    cast: readonly CharacterAliasCastMember[],
): CharacterAliasIssue | null {
    if (alias === self.name.trim()) {
        return { kind: "ownName" };
    }
    const others = cast.filter(member => member.id !== self.id);
    const named = others.filter(member => member.name === alias);
    if (named.length > 0) {
        return { kind: "name", names: named.map(member => member.name) };
    }
    const sharing = others.filter(member => member.nicknames.includes(alias));
    if (sharing.length > 0) {
        return { kind: "alias", names: sharing.map(member => member.name) };
    }
    return null;
}
