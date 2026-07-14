import { Character } from "@/lib/workspace/services/character/Character";
import {
    PropertyEditorSchema,
    FieldDefinition,
    SelectOption,
    createPropertyEditorSchema,
} from "../framework";
import type { Translator } from "@shared/i18n";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

/**
 * Context for character property editor
 */
export interface CharacterEditorContext {
    character: Character;
    thumbnailUrl: string | null;
    forms: Array<{ name: string }>;
}

/**
 * Character property editor schema
 */
export const characterPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<CharacterEditorContext>({
    id: "character",
    title: t("characters.properties.editorTitle"),
    fields: [
        {
            id: "thumbnail",
            type: "thumbnail",
            label: t("characters.properties.thumbnail"),
            getThumbnailUrl: (ctx) => ctx.thumbnailUrl,
            getThumbnailId: (ctx) => ctx.character.profile.getProfile().thumbnail,
            setThumbnail: async (ctx, id) => {
                ctx.character.profile.setThumbnail(id);
            },
            aspectRatio: 1,
            order: 10,
        },
        {
            id: "name",
            type: "text",
            label: t("common.name"),
            placeholder: t("characters.properties.namePlaceholder"),
            getValue: (ctx) => ctx.character.profile.getProfile().name,
            setValue: async (ctx, value) => {
                ctx.character.profile.setName(value);
            },
            order: 20,
        },
        {
            id: "description",
            type: "textarea",
            label: t("common.description"),
            placeholder: t("characters.properties.descriptionPlaceholder"),
            rows: 4,
            getValue: (ctx) => ctx.character.profile.getProfile().description,
            setValue: async (ctx, value) => {
                ctx.character.profile.setDescription(value);
            },
            order: 30,
        },
        {
            id: "tags",
            type: "tags",
            label: t("characters.properties.tags"),
            addPlaceholder: t("characters.properties.addTagPlaceholder"),
            getValue: (ctx) => ctx.character.profile.getProfile().tags || [],
            addTag: async (ctx, tag) => {
                ctx.character.profile.addTag(tag);
            },
            removeTag: async (ctx, tag) => {
                ctx.character.profile.removeTag(tag);
            },
            order: 40,
        },
        {
            id: "defaultForm",
            type: "select",
            label: t("characters.properties.defaultForm"),
            placeholder: t("characters.properties.selectDefaultForm"),
            options: (ctx): SelectOption[] => [
                { value: "", label: t("characters.properties.followFirstForm") },
                ...ctx.forms.map((form) => ({ value: form.name, label: form.name })),
            ],
            getValue: (ctx) => ctx.character.profile.getProfile().defaultForm ?? "",
            setValue: async (ctx, value) => {
                const next = value === "" ? null : String(value);
                ctx.character.profile.setDefaultForm(next);
            },
            order: 50,
        },
    ],
    showSavingIndicator: false,
});

