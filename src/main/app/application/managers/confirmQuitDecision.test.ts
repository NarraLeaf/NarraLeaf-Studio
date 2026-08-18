import { describe, expect, it } from "vitest";
import { decideQuitAction, type QuitState } from "./confirmQuitDecision";

type PartialInput = {
  type?: "keyDown" | "keyUp";
  key: string;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  isAutoRepeat?: boolean;
};

function press(input: PartialInput) {
  return {
    type: input.type ?? "keyDown",
    key: input.key,
    meta: input.meta ?? false,
    control: input.control ?? false,
    alt: input.alt ?? false,
    shift: input.shift ?? false,
    isAutoRepeat: input.isAutoRepeat ?? false
  } as Electron.Input;
}

const IDLE: QuitState = { enabled: true, pending: false };
const PENDING: QuitState = { enabled: true, pending: true };

describe("decideQuitAction", () => {
  it("takes the first ⌘Q and waits for the second", () => {
    expect(decideQuitAction(press({ key: "q", meta: true }), IDLE)).toBe("prime");
  });

  it("quits on the second ⌘Q", () => {
    expect(decideQuitAction(press({ key: "q", meta: true }), PENDING)).toBe("quit");
  });

  /**
   * The whole point of the change from a held key to two presses: leaning on ⌘Q is one press,
   * however many events the keyboard sends, and must never reach the second.
   */
  it("does not let a leaned-on ⌘Q become the second press", () => {
    expect(decideQuitAction(press({ key: "q", meta: true, isAutoRepeat: true }), PENDING)).toBe(
      "swallow"
    );
    expect(decideQuitAction(press({ key: "q", meta: true, isAutoRepeat: true }), IDLE)).toBe(
      "swallow"
    );
  });

  it("leaves ⌘Q alone when the preference is off, so the menu quits as it always did", () => {
    expect(
      decideQuitAction(press({ key: "q", meta: true }), { enabled: false, pending: false })
    ).toBe("ignore");
  });

  /**
   * ⇧⌘Q and ⌥⌘Q are the system's log-out shortcuts. Swallowing either would break a gesture
   * aimed past Studio at the operating system, and neither is a press of ours.
   */
  it.each([
    ["⇧⌘Q", press({ key: "Q", meta: true, shift: true })],
    ["⌥⌘Q", press({ key: "q", meta: true, alt: true })],
    ["⌃⌘Q", press({ key: "q", meta: true, control: true })],
    ["a bare Q", press({ key: "q" })]
  ])("does not claim %s", (_name, input) => {
    expect(decideQuitAction(input, IDLE)).toBe("ignore");
  });

  /**
   * Nothing here is measured against a release. macOS withholds key-up for ordinary keys while
   * Command is down, so a rule that read them would be reading an incomplete stream.
   */
  it.each(["Meta", "q", "a"])("ignores the key-up of %s", (key) => {
    expect(decideQuitAction(press({ type: "keyUp", key, meta: true }), PENDING)).toBe("ignore");
    expect(decideQuitAction(press({ type: "keyUp", key, meta: true }), IDLE)).toBe("ignore");
  });

  it("forgets the first press when the author goes back to work", () => {
    expect(decideQuitAction(press({ key: "s", meta: true }), PENDING)).toBe("cancel");
    expect(decideQuitAction(press({ key: "Escape" }), PENDING)).toBe("cancel");
    expect(decideQuitAction(press({ key: "a" }), PENDING)).toBe("cancel");
  });

  /**
   * ⌘ is pressed again on the way to the second ⌘Q, because most people let the whole chord up
   * in between. Counting that as "something else" would make the second press unreachable.
   */
  it.each(["Meta", "Shift", "Alt", "Control", "CapsLock"])(
    "survives %s between the two presses",
    (key) => {
      expect(decideQuitAction(press({ key, meta: true }), PENDING)).toBe("ignore");
    }
  );

  it("ignores ordinary typing when no press is waiting", () => {
    expect(decideQuitAction(press({ key: "a" }), IDLE)).toBe("ignore");
  });
});
