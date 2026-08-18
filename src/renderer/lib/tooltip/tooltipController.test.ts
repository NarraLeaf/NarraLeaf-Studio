// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveTooltipSide,
  setTooltipDelay,
  startTooltipTracking,
  type TooltipTarget
} from "./tooltipController";
import { TOOLTIP_DELAY_DEFAULT_MS } from "@/lib/settings/tooltipOptions";

/**
 * The state machine only. What the bubble looks like and where it lands is a matter for the eye;
 * when it appears is a matter of rules, and those are what break silently.
 */

const DELAY = 400;

let stop: (() => void) | null = null;
let shown: TooltipTarget | null = null;

/** jsdom has no layout, so the hit test is told what the pointer is over. */
let under: Element | null = null;

/**
 * A move the element itself never hears about, which is what the browser does over a disabled
 * control: the event is dispatched on the document, so only the hit test can find the target.
 */
function pointerOver(element: Element | null): void {
  under = element;
  document.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 })
  );
}

function move(target: Element, buttons = 0): void {
  under = target;
  target.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10, buttons })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setTooltipDelay(DELAY);
  shown = null;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
  document.elementFromPoint = () => under;
  under = null;
  document.body.innerHTML = `
        <div id="page">
            <button id="lonely" data-tip="Run"></button>
            <div id="strip" data-tip-group data-tip-side="right">
                <button id="undo" data-tip="Undo"></button>
                <button id="redo" data-tip="Redo"></button>
                <button id="stopped" data-tip="Frozen" disabled></button>
            </div>
            <button id="own-side" data-tip="Below" data-tip-side="bottom"></button>
        </div>
    `;
  stop = startTooltipTracking(document, (next) => {
    shown = next;
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const el = (id: string) => document.getElementById(id) as HTMLElement;

describe("tooltip delay", () => {
  it("waits before showing", () => {
    move(el("lonely"));
    expect(shown).toBeNull();
    vi.advanceTimersByTime(DELAY - 1);
    expect(shown).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown).toEqual({ anchor: el("lonely"), text: "Run", side: "top" });
  });

  it("defaults to the shipped delay", () => {
    setTooltipDelay(Number.NaN);
    setTooltipDelay(TOOLTIP_DELAY_DEFAULT_MS);
    move(el("lonely"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_DEFAULT_MS);
    expect(shown).not.toBeNull();
  });

  it("drops the pending tooltip when the pointer leaves before it is due", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY - 50);
    pointerOver(el("page"));
    vi.advanceTimersByTime(DELAY);
    expect(shown).toBeNull();
  });

  it("does not restart the wait while the pointer rests on the same control", () => {
    // A hand on a mouse is never quite still. Every one of these moves used to push the tooltip
    // another full delay into the future, so it never arrived.
    for (let i = 0; i < 10; i += 1) {
      move(el("lonely"));
      vi.advanceTimersByTime(60);
    }
    expect(shown).toEqual({ anchor: el("lonely"), text: "Run", side: "top" });
  });

  it("shows the words the control has when the wait is up, not the ones it had", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY - 100);
    el("lonely").setAttribute("data-tip", "Stop");
    vi.advanceTimersByTime(100);
    expect(shown).toEqual({ anchor: el("lonely"), text: "Stop", side: "top" });
  });

  it("shows nothing while a button is held, because that pointer is drawing", () => {
    move(el("lonely"), 1);
    vi.advanceTimersByTime(DELAY);
    expect(shown).toBeNull();
  });
});

describe("hot chain", () => {
  it("charges the delay once for the strip, then answers immediately inside it", () => {
    move(el("undo"));
    vi.advanceTimersByTime(DELAY);
    expect(shown).toEqual({ anchor: el("undo"), text: "Undo", side: "right" });

    move(el("redo"));
    expect(shown).toEqual({ anchor: el("redo"), text: "Redo", side: "right" });
  });

  it("cools the moment the pointer is outside the strip", () => {
    move(el("undo"));
    vi.advanceTimersByTime(DELAY);
    pointerOver(el("page"));
    expect(shown).toBeNull();

    move(el("redo"));
    expect(shown).toBeNull();
    vi.advanceTimersByTime(DELAY);
    expect(shown).toEqual({ anchor: el("redo"), text: "Redo", side: "right" });
  });

  it("does not warm a lone control's neighbours", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY);
    move(el("undo"));
    expect(shown).toBeNull();
  });
});

describe("controls that receive no pointer events", () => {
  it("reads a disabled button through the hit test", () => {
    // What the browser does: the event lands on the container, never on the disabled button.
    pointerOver(el("stopped"));
    vi.advanceTimersByTime(DELAY);
    expect(shown).toEqual({ anchor: el("stopped"), text: "Frozen", side: "right" });
  });
});

describe("which way it opens", () => {
  it("takes the side its strip declares", () => {
    move(el("undo"));
    vi.advanceTimersByTime(DELAY);
    expect(shown?.side).toBe("right");
  });

  it("lets a lone control state its own", () => {
    move(el("own-side"));
    vi.advanceTimersByTime(DELAY);
    expect(shown?.side).toBe("bottom");
  });

  it("opens above when nothing says otherwise", () => {
    expect(resolveTooltipSide(el("lonely"))).toBe("top");
  });
});

describe("dismissal", () => {
  it("goes away on a press", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY);
    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(shown).toBeNull();
  });

  it("goes away on a keystroke", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    expect(shown).toBeNull();
  });

  it("redraws when the same control changes its words", () => {
    move(el("lonely"));
    vi.advanceTimersByTime(DELAY);
    el("lonely").setAttribute("data-tip", "Stop");
    move(el("lonely"));
    expect(shown).toEqual({ anchor: el("lonely"), text: "Stop", side: "top" });
  });
});
