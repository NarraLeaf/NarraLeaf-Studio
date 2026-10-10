// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TagsFieldDefinition } from "../types";
import { TagsField } from "./TagsField";

/**
 * Where the caret is around the tags field.
 *
 * The field takes focus back after an add, because it is disabled while the tag saves and that drops
 * focus. It used to take focus on mount as well, since it also starts out empty: selecting an asset
 * opened its properties and put the caret in this field, and every key of the asset panel and the
 * preview that stays quiet while typing stopped answering.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

afterEach(cleanup);

/** Longer than the field's own refocus delay. */
const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 40)));

function tagsField(data: { tags: string[] }): TagsFieldDefinition<{ tags: string[] }> {
    return {
        id: "tags",
        type: "tags",
        label: "Tags",
        getValue: value => value.tags,
        addTag: async (value, tag) => {
            value.tags.push(tag);
        },
        removeTag: async (value, tag) => {
            value.tags = value.tags.filter(existing => existing !== tag);
        },
    };
}

describe("TagsField focus", () => {
    it("leaves focus where it is when it mounts", async () => {
        const data = { tags: [] as string[] };
        render(
            <>
                <button type="button">asset row</button>
                <TagsField field={tagsField(data)} data={data} onSaving={() => undefined} />
            </>,
        );
        const row = screen.getByRole("button", { name: "asset row" });
        row.focus();
        await settle();
        expect(document.activeElement).toBe(row);
    });

    it("takes focus back after a tag is added", async () => {
        const data = { tags: [] as string[] };
        render(<TagsField field={tagsField(data)} data={data} onSaving={() => undefined} />);
        const input = screen.getByPlaceholderText("properties.tags.addPlaceholder");
        input.focus();
        fireEvent.change(input, { target: { value: "night" } });
        fireEvent.keyDown(input, { key: "Enter" });
        // Saving disables the field, which drops focus; the add is what brings it back.
        input.blur();
        await settle();
        expect(data.tags).toEqual(["night"]);
        expect(document.activeElement).toBe(input);
    });
});
