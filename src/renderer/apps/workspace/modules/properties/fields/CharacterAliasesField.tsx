import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { Services } from "@/lib/workspace/services/services";
import { TagsField } from "../framework/fields/TagsField";
import type { CustomFieldProps, TagsFieldDefinition } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";
import {
    characterAliasIssue,
    normalizeCharacterAliases,
    type CharacterAliasCastMember,
} from "./characterAliases";

/**
 * A character's aliases (`profile.nicknames`): other spellings a story line's speaker binds to this
 * character by, while the game goes on showing the character's name.
 *
 * A `custom` field around the framework's `TagsField` for two reasons the schema's context cannot
 * meet. Each edit lands through `CharacterService.commitCharacterRecord`, so it is one step of undo
 * on the project stack, where a setter on the live profile leaves none. And whether an alias works
 * depends on the rest of the cast, so the field listens to the cast, not only to this character.
 *
 * An alias another character is named, or shares, is kept and warned about rather than refused: the
 * author may be about to rename the other character, and refusing would make the order of two edits
 * matter.
 */
function readCast(service: CharacterService | null): CharacterAliasCastMember[] {
    return (service?.listCharacter() ?? []).map(member => ({
        id: member.profile.getId(),
        name: member.profile.getName(),
        nicknames: [...member.profile.getNicknames()],
    }));
}

export function CharacterAliasesField({ data, disabled }: CustomFieldProps<CharacterEditorContext>) {
    const { t, formatList } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<CharacterService>(Services.Character) : null),
        [context, isInitialized],
    );
    const character = data.character;

    const [cast, setCast] = useState<CharacterAliasCastMember[]>(() => readCast(service));
    useEffect(() => {
        setCast(readCast(service));
        if (!service) {
            return;
        }
        return service.subscribe(() => setCast(readCast(service)));
    }, [service]);

    const commit = (next: string[]): void => {
        const profile = character.profile;
        const aliases = normalizeCharacterAliases(next, profile.getName());
        if (!service) {
            return;
        }
        const draft = Character.fromJSON(character.toJSON());
        for (const existing of [...draft.profile.getNicknames()]) {
            draft.profile.removeNickname(existing);
        }
        for (const alias of aliases) {
            draft.profile.addNickname(alias);
        }
        service.commitCharacterRecord(draft.toJSON(), {
            key: "characters.history.editCharacter" as TranslationKey,
            params: { name: profile.getName() },
        });
    };

    const field: TagsFieldDefinition<CharacterEditorContext> = {
        id: "nicknames",
        type: "tags",
        disabled,
        addPlaceholder: t("characters.properties.addAliasPlaceholder"),
        getValue: ctx => ctx.character.profile.getNicknames(),
        addTag: (ctx, alias) => commit([...ctx.character.profile.getNicknames(), alias]),
        removeTag: (ctx, alias) => commit(ctx.character.profile.getNicknames().filter(item => item !== alias)),
        rejectTag: (ctx, alias) => normalizeCharacterAliases([alias], ctx.character.profile.getName()).length === 0,
        tagIssue: (ctx, alias) => {
            const profile = ctx.character.profile;
            const issue = characterAliasIssue(alias, { id: profile.getId(), name: profile.getName() }, cast);
            if (!issue) {
                return null;
            }
            if (issue.kind === "ownName") {
                return t("characters.properties.aliasIsName", { alias });
            }
            const names = formatList(issue.names);
            return issue.kind === "name"
                ? t("characters.properties.aliasTakenByName", { alias, names })
                : t("characters.properties.aliasShared", { alias, names });
        },
    };

    return <TagsField field={field} data={data} onSaving={() => undefined} />;
}
