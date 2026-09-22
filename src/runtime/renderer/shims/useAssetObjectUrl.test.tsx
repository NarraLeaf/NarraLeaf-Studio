// @vitest-environment jsdom
/**
 * The packaged game's asset hook answers from an effect. Most widgets that could draw an asset have
 * none, and for them the answer is the state they already hold - which must not draw them again.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAssetObjectUrl } from "./useAssetObjectUrl";

afterEach(() => cleanup());

describe("useAssetObjectUrl (packaged game)", () => {
    it("does not draw a widget with no asset a second time", () => {
        let renders = 0;
        let url: string | null | undefined;
        function Probe() {
            renders += 1;
            url = useAssetObjectUrl(null).url;
            return null;
        }
        render(<Probe />);

        expect(renders).toBe(1);
        expect(url).toBeNull();
    });

    it("still answers for an asset it cannot find", () => {
        let error: string | null = null;
        function Probe() {
            error = useAssetObjectUrl("missing-asset").error;
            return null;
        }
        render(<Probe />);

        expect(error).toBe("Runtime asset not found: missing-asset");
    });
});
