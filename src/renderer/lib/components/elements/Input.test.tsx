// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input, InputGroup } from "./Input";
import { Select } from "./Select";

afterEach(cleanup);

describe("InputGroup labels", () => {
    it("associates a field label with its input and preserves an existing id", () => {
        const onClick = vi.fn();
        render(<InputGroup label="Project name"><Input id="project-name" onClick={onClick} /></InputGroup>);

        expect(screen.getByLabelText("Project name").id).toBe("project-name");
        fireEvent.click(screen.getByText("Project name"));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("opens a select when its field label is clicked", () => {
        render(
            <InputGroup label="Data type">
                <Select value="text" options={[{ value: "text", label: "Text" }]} />
            </InputGroup>,
        );

        fireEvent.click(screen.getByText("Data type"));
        expect(screen.getByRole("listbox")).toBeTruthy();
    });
});
