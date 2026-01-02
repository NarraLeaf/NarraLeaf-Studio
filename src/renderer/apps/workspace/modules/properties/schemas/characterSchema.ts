import { Character } from "@/lib/workspace/services/character/Character";
import {
    PropertyEditorSchema,
    FieldDefinition,
    SelectOption,
    createPropertyEditorSchema,
} from "../framework";

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
export const characterPropertySchema = createPropertyEditorSchema<CharacterEditorContext>({
    id: "character",
    title: "Character Properties",
    fields: [
        {
            id: "thumbnail",
            type: "thumbnail",
            label: "Thumbnail",
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
            label: "Name",
            placeholder: "Character name",
            getValue: (ctx) => ctx.character.profile.getProfile().name,
            setValue: async (ctx, value) => {
                ctx.character.profile.setName(value);
            },
            order: 20,
        },
        {
            id: "description",
            type: "textarea",
            label: "Description",
            placeholder: "Character description...",
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
            label: "Tags",
            addPlaceholder: "Add tag...",
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
            label: "Default Form",
            placeholder: "Select default form",
            options: (ctx): SelectOption[] => [
                { value: "", label: "Follow first form" },
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

