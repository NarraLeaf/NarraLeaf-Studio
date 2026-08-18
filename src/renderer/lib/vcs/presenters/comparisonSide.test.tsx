// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSideObjectUrl, type ComparisonSide } from "./comparisonSide";

/**
 * **Every object URL this makes is revoked.**
 *
 * A blob URL keeps its bytes alive until it is revoked or the document goes away, and this hook
 * feeds a pane an author moves through file by file: a few dozen selections of a few megabytes
 * each is a few hundred megabytes retained inside a window that is also running their project.
 * Nothing on screen changes when it leaks, which is why it is pinned here rather than noticed.
 *
 * Both ways a URL stops being wanted get a test: the selection moving to another file, and the
 * pane going away.
 */

const service = vi.hoisted(() => ({
  readBlob: vi.fn(),
  readWorkingFile: vi.fn()
}));
vi.mock("@/apps/workspace/context", () => ({
  useWorkspace: () => ({ context: { services: { get: () => service } } })
}));

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let next = 0;
  URL.createObjectURL = vi.fn(() => {
    next += 1;
    const url = `blob:image-${next}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  service.readBlob.mockResolvedValue(new Uint8Array([1, 2, 3]));
  service.readWorkingFile.mockResolvedValue(new Uint8Array([4, 5, 6, 7]));
});

afterEach(() => {
  cleanup();
  service.readBlob.mockReset();
  service.readWorkingFile.mockReset();
});

function Probe({
  side,
  path,
  mediaType = "image/png"
}: {
  side: ComparisonSide | null;
  path: string;
  mediaType?: string | null;
}) {
  const state = useSideObjectUrl(side, path, () => mediaType);
  return (
    <span data-testid="side" data-url={state.url ?? ""} data-size={state.size}>
      {state.status}
    </span>
  );
}

const status = (): string => screen.getByTestId("side").textContent ?? "";
const url = (): string => screen.getByTestId("side").getAttribute("data-url") ?? "";

describe("reading one side of a comparison", () => {
  it("reads the working tree through the working-tree verb and a revision through readBlob", async () => {
    const { rerender } = render(<Probe side={{ at: "working-tree" }} path="assets/content/a" />);
    await waitFor(() => expect(status()).toBe("ready"));

    expect(service.readWorkingFile).toHaveBeenCalledWith("assets/content/a");
    expect(service.readBlob).not.toHaveBeenCalled();

    rerender(<Probe side={{ at: "revision", revision: "r7" }} path="assets/content/a" />);
    await waitFor(() => expect(service.readBlob).toHaveBeenCalledWith("r7", "assets/content/a"));
  });

  it("asks for nothing at all for a side that does not hold the file", async () => {
    render(<Probe side={null} path="assets/content/a" />);

    await waitFor(() => expect(status()).toBe("absent"));
    expect(service.readWorkingFile).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("reports a file the read refused to hand over, and makes no URL for it", async () => {
    service.readWorkingFile.mockResolvedValue(null);

    render(<Probe side={{ at: "working-tree" }} path="assets/content/huge" />);

    await waitFor(() => expect(status()).toBe("tooLarge"));
    expect(created).toEqual([]);
  });

  it("reports bytes the caller cannot draw, and makes no URL for those either", async () => {
    // A URL with the wrong type is a broken element with no explanation attached, so the
    // caller saying "not this format" has to stop the URL being made at all.
    render(<Probe side={{ at: "working-tree" }} path="assets/content/tiff" mediaType={null} />);

    await waitFor(() => expect(status()).toBe("unsupported"));
    expect(created).toEqual([]);
  });

  it("reports the read's own failure rather than an empty picture", async () => {
    service.readWorkingFile.mockRejectedValue(new Error("it escapes the project directory"));

    render(<Probe side={{ at: "working-tree" }} path="../outside.png" />);

    await waitFor(() => expect(status()).toBe("failed"));
    expect(created).toEqual([]);
  });
});

describe("what happens to the URL", () => {
  it("revokes the previous file's URL when the selection moves", async () => {
    const { rerender } = render(<Probe side={{ at: "working-tree" }} path="assets/content/a" />);
    await waitFor(() => expect(status()).toBe("ready"));
    const first = url();

    rerender(<Probe side={{ at: "working-tree" }} path="assets/content/b" />);
    await waitFor(() => expect(url()).not.toBe(first));

    expect(revoked).toEqual([first]);
    expect(created).toHaveLength(2);
  });

  it("revokes the URL when the pane goes away", async () => {
    const { unmount } = render(<Probe side={{ at: "working-tree" }} path="assets/content/a" />);
    await waitFor(() => expect(status()).toBe("ready"));
    const only = url();

    unmount();

    expect(revoked).toEqual([only]);
  });

  it("revokes a URL that arrived after the pane went away", async () => {
    // The read is out when the author moves on, so the URL is made by a callback nothing is
    // watching any more. Losing this one leaks exactly the files someone clicked past.
    let answer: (bytes: Uint8Array) => void = () => undefined;
    service.readWorkingFile.mockReturnValue(
      new Promise<Uint8Array>((resolve) => {
        answer = resolve;
      })
    );

    const { unmount } = render(<Probe side={{ at: "working-tree" }} path="assets/content/slow" />);
    await waitFor(() => expect(status()).toBe("loading"));
    unmount();
    answer(new Uint8Array([9]));
    await Promise.resolve();

    // Nothing was made, which is the same outcome and a cheaper one: the read is abandoned
    // before a URL exists rather than made and revoked.
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
  });
});
