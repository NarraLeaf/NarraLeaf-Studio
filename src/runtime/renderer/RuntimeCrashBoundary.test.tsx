// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const logged: Array<{ level: string; message: string }> = [];
let bridge: { log: (level: string, message: string) => void } | null = null;

vi.mock("@/lib/ui-editor/runtime/gameRuntimeBridge", () => ({
  getGameRuntimeBridge: () => bridge
}));

// The vitest alias maps `@` at the Studio renderer, so `@/lib/i18n` would resolve to the editor's
// live store rather than the fixed-locale shim the runtime bundle is built with. Keys are enough
// here: what is under test is the catching and the reporting, not the wording.
vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

import { RuntimeCrashBoundary } from "./RuntimeCrashBoundary";
import { clearAutomaticRestarts, setRuntimeCrashPolicy } from "./crashPolicy";

function Exploding(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'designSize')");
}

describe("RuntimeCrashBoundary", () => {
  beforeEach(() => {
    logged.length = 0;
    bridge = {
      log: (level, message) => {
        logged.push({ level, message });
      }
    };
    // React prints the caught error itself; the test is not interested in its copy.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    clearAutomaticRestarts();
    setRuntimeCrashPolicy("details");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("draws the game through when nothing is wrong", () => {
    render(
      <RuntimeCrashBoundary>
        <p>the game</p>
      </RuntimeCrashBoundary>
    );

    expect(screen.getByText("the game")).toBeTruthy();
  });

  it("shows the crash screen instead of leaving the window black", () => {
    render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    expect(screen.getByText("game.crash.title")).toBeTruthy();
    expect(screen.getByText("game.crash.restart")).toBeTruthy();
  });

  it("reports the failure with its stack, which is the only record a shipped game keeps", () => {
    render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe("error");
    expect(logged[0].message).toContain("designSize");
    expect(logged[0].message).toContain("RuntimeCrashBoundary.test");
  });

  it("still shows the screen when there is no bridge to report to", () => {
    // A crash early enough in boot that the preload has not installed one.
    bridge = null;

    expect(() =>
      render(
        <RuntimeCrashBoundary>
          <Exploding />
        </RuntimeCrashBoundary>
      )
    ).not.toThrow();
    expect(screen.getByText("game.crash.title")).toBeTruthy();
  });

  it("keeps the stack off the screen when the project asked for the log only", () => {
    setRuntimeCrashPolicy("log");

    render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    // The message still stands; what a player cannot act on does not.
    expect(screen.getByText("game.crash.title")).toBeTruthy();
    expect(screen.queryByText("game.crash.showDetails")).toBeNull();
    // And the failure is still recorded, which is the floor under all three policies.
    expect(logged).toHaveLength(1);
  });

  it("restarts instead of drawing anything when the project asked it to", () => {
    setRuntimeCrashPolicy("restart");
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload }
    });

    render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(logged.some((entry) => entry.message.includes("policy: restart"))).toBe(true);
  });

  it("stops restarting and shows the screen once it is clearly not working", () => {
    setRuntimeCrashPolicy("restart");
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload }
    });

    // Three restarts already spent on this failure: the fourth has to become a screen, or the
    // player watches a window flicker forever with nothing to read.
    for (let attempt = 0; attempt < 3; attempt++) {
      cleanup();
      render(
        <RuntimeCrashBoundary>
          <Exploding />
        </RuntimeCrashBoundary>
      );
    }
    cleanup();
    render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    expect(reload).toHaveBeenCalledTimes(3);
    expect(screen.getByText("game.crash.title")).toBeTruthy();
  });

  it("keeps the player's way out reachable in a small window", () => {
    // A game window may be 480x320. The screen used to centre its content with no scrolling,
    // so once the details opened the title and the Restart button went off the top with no way
    // back to them. jsdom does no layout, so this guards the contract that prevents it.
    const { container } = render(
      <RuntimeCrashBoundary>
        <Exploding />
      </RuntimeCrashBoundary>
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-y-auto");
    expect((root.firstElementChild as HTMLElement).className).toContain("min-h-full");
  });
});
