// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIPageParam, UISurface } from "@shared/types/ui-editor/document";
import { normalizeUIPageParams } from "@shared/types/ui-editor/pageParams";
import type { SceneEditorContext } from "./schemas/sceneSchema";
import { SurfacePageParamsField } from "./PageParamsEditor";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, writes: () => ({}) }),
}));

afterEach(cleanup);

function renderPage(initial: UIPageParam[]) {
    const write = vi.fn();
    function Editor() {
        const [params, setParams] = useState(initial);
        const surface = { id: "page", kind: "appSurface", params } as UISurface;
        const documentService = {
            getDocument: () => ({ surfaces: [surface] }),
            setPageParams: (_id: string, next: UIPageParam[]) => {
                write(next);
                setParams(normalizeUIPageParams(next));
            },
        };
        return <SurfacePageParamsField data={{ surface, documentService } as unknown as SceneEditorContext} onChange={() => undefined} />;
    }
    render(<Editor />);
    return write;
}

describe("page parameter declarations", () => {
    it("clears a number's explicit default when its input is emptied", () => {
        const write = renderPage([{ id: "count", name: "count", type: "number", defaultValue: 12 }]);
        const input = screen.getByRole("textbox", { name: "properties.pageParams.default" });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.blur(input);
        expect(normalizeUIPageParams(write.mock.calls.at(-1)![0])).toEqual([
            { id: "count", name: "count", type: "number" },
        ]);
    });

    it("clears a list's row shape when any shape is selected", () => {
        const write = renderPage([{ id: "items", name: "items", type: "list", struct: "nl.ending" }]);
        fireEvent.click(screen.getByRole("button", { name: "properties.pageParams.rowShape" }));
        fireEvent.click(screen.getByRole("option", { name: "properties.pageParams.anyShape" }));
        expect(normalizeUIPageParams(write.mock.calls.at(-1)![0])).toEqual([
            { id: "items", name: "items", type: "list" },
        ]);
    });

    it("drops a scalar default when changing the parameter to a list", () => {
        const write = renderPage([{ id: "count", name: "count", type: "number", defaultValue: 12 }]);
        fireEvent.click(screen.getByRole("button", { name: "properties.pageParams.type" }));
        fireEvent.click(screen.getByRole("option", { name: /list/i }));
        expect(normalizeUIPageParams(write.mock.calls.at(-1)![0])).toEqual([
            { id: "count", name: "count", type: "list" },
        ]);
    });
});
