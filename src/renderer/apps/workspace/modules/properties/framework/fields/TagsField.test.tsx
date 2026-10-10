// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagsField } from "./TagsField";
import type { TagsFieldDefinition } from "../types";

/**
 * Where the caret is after the tags field mounts, and after a tag is added.
 *
 * The field used to focus its input whenever the input was empty - which is also how it mounts - so
 * selecting an asset put the caret in "Add tag…" and moved keyboard focus into the inspector.
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

vi.mock("./comparisonFieldMarks", () => ({
    useComparisonFieldMark: () => null,
}));

afterEach(cleanup);

type Data = { tags: string[] };

function definition(): TagsFieldDefinition<Data> {
    return {
        id: "tags",
        type: "tags",
        label: "Tags",
        addPlaceholder: "Add tag",
        getValue: data => data.tags,
        addTag: (data, tag) => {
            data.tags = [...data.tags, tag];
        },
        removeTag: (data, tag) => {
            data.tags = data.tags.filter(entry => entry !== tag);
        },
    };
}

const input = () => screen.getByPlaceholderText("Add tag");

describe("the tags field's focus", () => {
    it("leaves the focus where it was when it mounts", async () => {
        vi.useFakeTimers();
        try {
            render(<TagsField field={definition()} data={{ tags: [] }} onSaving={() => undefined} />);
            await act(async () => {
                vi.advanceTimersByTime(50);
            });
            expect(document.activeElement).not.toBe(input());
        } finally {
            vi.useRealTimers();
        }
    });

    it("goes back into the input after a tag is added", async () => {
        vi.useFakeTimers();
        try {
            const data = { tags: [] as string[] };
            render(<TagsField field={definition()} data={data} onSaving={() => undefined} />);
            fireEvent.change(input(), { target: { value: "night" } });
            await act(async () => {
                fireEvent.keyDown(input(), { key: "Enter" });
            });
            await act(async () => {
                vi.advanceTimersByTime(50);
            });
            expect(data.tags).toEqual(["night"]);
            expect(document.activeElement).toBe(input());
        } finally {
            vi.useRealTimers();
        }
    });
});
