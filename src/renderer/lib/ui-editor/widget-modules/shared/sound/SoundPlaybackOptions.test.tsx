// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundVolumeControl } from "./SoundPlaybackOptions";

afterEach(cleanup);

describe("sound volume controls", () => {
    it("keeps a typed value when Tab passes through the slider, then commits an adjustment", () => {
        const onCommit = vi.fn();
        function Volume() {
            const [volume, setVolume] = useState(0.6);
            return <SoundVolumeControl volume={volume} label="Volume" onChange={next => {
                onCommit(next);
                if (next !== null) setVolume(next);
            }} />;
        }
        render(<Volume />);
        const box = screen.getByRole("textbox", { name: "Volume" });
        const slider = screen.getByRole("slider", { name: "Volume" });
        fireEvent.change(box, { target: { value: "0.62" } });
        fireEvent.blur(box);
        expect(onCommit).toHaveBeenLastCalledWith(0.62);
        onCommit.mockClear();

        fireEvent.keyUp(slider, { key: "Tab" });
        expect(onCommit).not.toHaveBeenCalled();
        expect((slider as HTMLInputElement).value).toBe("0.62");

        fireEvent.change(slider, { target: { value: "0.67" } });
        fireEvent.keyUp(slider, { key: "ArrowUp" });
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(0.65);
    });
});
