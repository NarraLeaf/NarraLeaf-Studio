// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import type { ComparisonSides, SideContent } from "./comparisonSide";

/**
 * What the sound comparison must never do: claim a file it cannot play, draw two lengths as one
 * length, draw an empty track beside a file that only exists on one side, or leave a flat line on
 * screen when the decoder refused the bytes.
 *
 * **jsdom decodes nothing and paints nothing.** There is no Web Audio here and `getContext("2d")`
 * answers null, so what is stubbed below is the decoder, and what is asserted is structure: how
 * many tracks, how wide each one is, and which sentence is on screen instead of a waveform. The
 * waveform itself, and whether anything comes out of the speakers, are only checkable by a person.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    has: () => false,
    tn: (key: string) => key,
    locale: "en"
  })
}));

const sideStates = vi.hoisted(() => new Map<string, unknown>());
const ABSENT = { status: "absent", value: null, size: 0, error: null };
vi.mock("./comparisonSide", () => ({
  useSideBytes: (side: { at: string } | null) => {
    if (!side) return ABSENT;
    return sideStates.get(side.at === "revision" ? "before" : "after") ?? ABSENT;
  },
  // The image presenter is imported by the host and reads this one. Left out, the named import
  // throws before a single test runs.
  useSideObjectUrl: () => ({ status: "absent", url: null, size: 0, error: null }),
  comparisonSideKey: () => "mocked"
}));

/** What the stubbed decoder answers with, keyed by the first byte of what it was handed. */
const decoded = new Map<number, FakeAudioBuffer>();

class FakeAudioBuffer {
  constructor(
    public readonly duration: number,
    public readonly sampleRate = 44100,
    public readonly numberOfChannels = 2
  ) {}

  getChannelData(): Float32Array {
    return new Float32Array(128).fill(0.5);
  }
}

const started: number[] = [];
const resumed = vi.fn();

class FakeSource {
  public buffer: unknown = null;
  public onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  stop = vi.fn();
  start = vi.fn((_when: number, offset: number) => started.push(offset));
}

class FakeAudioContext {
  public state: "running" | "suspended" = "running";
  public currentTime = 0;
  public readonly destination = {};
  public sources: FakeSource[] = [];

  decodeAudioData(buffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    const answer = decoded.get(new Uint8Array(buffer)[0]);
    return answer ? Promise.resolve(answer) : Promise.reject(new Error("cannot decode"));
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  resume(): Promise<void> {
    resumed();
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

let context: FakeAudioContext;

const SIDES: ComparisonSides = {
  before: { at: "revision", revision: "r1" },
  after: { at: "working-tree" }
};

/** A side whose bytes lead with `mark`, which is what the stubbed decoder keys on. */
function ready(mark: number, size = 4096): SideContent<Uint8Array> {
  return { status: "ready", value: new Uint8Array([mark, 0, 0, 0]), size, error: null };
}

function entry(over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
  return {
    path: "assets/content/99/55/3d15abb54213bad7203798a1adc4",
    kind: "changed",
    contentClass: "audio",
    diff: {
      changes: [{ path: [], kind: "changed", label: { key: "documentDiff.content.changed" } }],
      complete: true,
      total: 1,
      tier: "content"
    },
    ...over
  };
}

function draw(over: Partial<DocumentDiffEntry> = {}) {
  return render(<ChangeDetailHost entry={entry(over)} sides={SIDES} />);
}

/** The box each waveform is drawn in: the canvas's own parent. */
const trackWidths = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("canvas")].map(
    (canvas) => (canvas.parentElement as HTMLElement).style.width
  );

beforeEach(() => {
  decoded.clear();
  sideStates.clear();
  started.length = 0;
  resumed.mockClear();
  context = new FakeAudioContext();
  vi.stubGlobal("AudioContext", function AudioContextStub(this: unknown) {
    return context;
  });
  // jsdom has no 2D context and says so, loudly, once per canvas. The presenter already handles
  // a null one - there is nothing to paint on - and this keeps the run readable.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("which presenter draws a sound file", () => {
  it("hands audio to the sound presenter rather than to the list of rows", () => {
    const { container } = draw();

    expect(
      container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter")
    ).toBe("audio");
  });

  it("leaves an image to the image presenter", () => {
    const { container } = render(
      <ChangeDetailHost entry={entry({ contentClass: "bitmap" })} sides={SIDES} />
    );

    expect(
      container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter")
    ).toBe("bitmap");
  });
});

describe("two versions on one timeline", () => {
  it("draws the shorter version short instead of stretching it to the same width", async () => {
    // The failure this presenter exists to avoid: fitted to their own boxes, a three second
    // cue and a five second one are the same picture, and the two extra seconds - the thing
    // that will run over the next line of dialogue - are nowhere on screen.
    decoded.set(1, new FakeAudioBuffer(3));
    decoded.set(2, new FakeAudioBuffer(5));
    sideStates.set("before", ready(1));
    sideStates.set("after", ready(2));

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    expect(trackWidths(container)).toEqual(["60%", "100%"]);
  });

  it("states each side's numbers once, and marks the ones that changed", async () => {
    decoded.set(1, new FakeAudioBuffer(3, 44100, 2));
    decoded.set(2, new FakeAudioBuffer(5, 22050, 1));
    sideStates.set("before", ready(1));
    sideStates.set("after", ready(2));

    const { container } = draw();

    await waitFor(() => expect(container.textContent).toContain("0:03.0 → 0:05.0"));
    expect(container.textContent).toContain("44.1 kHz → 22.1 kHz");
    expect(container.textContent).toContain(
      "documentDiff.presenter.audio.stereo → documentDiff.presenter.audio.mono"
    );
  });

  it("does not offer a comparison of numbers that did not change", async () => {
    decoded.set(1, new FakeAudioBuffer(4, 44100, 2));
    decoded.set(2, new FakeAudioBuffer(4, 44100, 2));
    sideStates.set("before", ready(1));
    sideStates.set("after", ready(2));

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    expect(container.textContent).not.toContain("→");
  });
});

describe("a sound that exists on one side", () => {
  it("draws the one track, with no empty one beside it", async () => {
    decoded.set(2, new FakeAudioBuffer(2));
    sideStates.set("after", ready(2));

    const { container } = draw({ kind: "added" });

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    expect(container.textContent).toContain("documentDiff.shell.fileAdded");
    expect(trackWidths(container)).toEqual(["100%"]);
  });

  it("draws the version that went away for a removal", async () => {
    decoded.set(1, new FakeAudioBuffer(2));
    sideStates.set("before", ready(1));

    const { container } = draw({ kind: "removed" });

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    expect(container.textContent).toContain("documentDiff.shell.fileRemoved");
  });
});

describe("playing one of them", () => {
  it("resumes a context that came back suspended, rather than starting a silent node", async () => {
    // The failure mode a time code cannot see: a window that has not been clicked in hands
    // back a suspended context, where `start()` is accepted and nothing is audible.
    decoded.set(1, new FakeAudioBuffer(3));
    decoded.set(2, new FakeAudioBuffer(3));
    sideStates.set("before", ready(1));
    sideStates.set("after", ready(2));
    context.state = "suspended";

    const { container } = draw();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    fireEvent.click(container.querySelectorAll("button")[0]);

    expect(resumed).toHaveBeenCalled();
    expect(started).toEqual([0]);
  });

  it("plays one side at a time", async () => {
    decoded.set(1, new FakeAudioBuffer(3));
    decoded.set(2, new FakeAudioBuffer(3));
    sideStates.set("before", ready(1));
    sideStates.set("after", ready(2));

    const { container } = draw();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    const buttons = [...container.querySelectorAll("button")];
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    // Two versions of one cue overlapping is not a comparison of them: the first node is
    // stopped before the second one starts.
    expect(context.sources[0].stop).toHaveBeenCalled();
    expect(started).toHaveLength(2);
  });

  it("offers no control for a side that could not be decoded", async () => {
    sideStates.set("before", ready(9));
    sideStates.set("after", ready(2));
    decoded.set(2, new FakeAudioBuffer(3));

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons[0].hasAttribute("disabled")).toBe(true);
    expect(buttons[1].hasAttribute("disabled")).toBe(false);
  });
});

describe("when a sound cannot be shown", () => {
  it("says the decoder refused it rather than drawing an empty line", async () => {
    // Nothing was registered for these bytes, so the stubbed decoder rejects them - the same
    // thing Web Audio does with a truncated file, or with a format it has no decoder for.
    sideStates.set("before", ready(9));
    sideStates.set("after", ready(9));

    const { container } = draw();

    await waitFor(() =>
      expect(container.textContent).toContain("documentDiff.presenter.audio.unreadable")
    );
    // The generic list is still under it: a file nobody can play is still a file something can
    // describe.
    expect(container.textContent).toContain("documentDiff.content.changed");
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("says which limit was met, and keeps the side that could be read", async () => {
    decoded.set(1, new FakeAudioBuffer(3));
    sideStates.set("before", ready(1));
    sideStates.set("after", { status: "tooLarge", value: null, size: 0, error: null });

    const { container } = draw();

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    // Both tracks are there: dropping the one with no waveform in it would leave the reason
    // nowhere on screen.
    expect(container.textContent).toContain("documentDiff.presenter.audio.tooLarge");
  });
});
