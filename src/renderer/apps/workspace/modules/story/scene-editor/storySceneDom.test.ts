// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isTextInputActive } from "./storySceneDom";

afterEach(() => {
  document.body.innerHTML = "";
});

function focus<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  prepare?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  prepare?.(element);
  document.body.appendChild(element);
  element.focus();
  return element;
}

/**
 * The predicate every editor-wide gesture is gated on: "is the author typing into something?".
 *
 * Its `except` argument is what makes `Ctrl+Shift+V` reachable from the insert slot. The slot is the
 * one text input whose paste this editor takes over - the root paste handler has always had a
 * carve-out for it - but the keydown that arms the gesture did not, so with the caret in the slot the
 * flag was never set and the paste opened the wizard the author had just asked to skip.
 */
describe("isTextInputActive", () => {
  it("is true for the fields the author types into", () => {
    focus("input");
    expect(isTextInputActive()).toBe(true);

    document.body.innerHTML = "";
    focus("textarea");
    expect(isTextInputActive()).toBe(true);

    document.body.innerHTML = "";
    focus("select");
    expect(isTextInputActive()).toBe(true);
  });

  // Loosely asserted because jsdom does not implement `isContentEditable`, which the last arm of the
  // predicate reads: with nothing focused the answer is `undefined` here and `false` in Chromium.
  it("is false when nothing has the caret", () => {
    expect(isTextInputActive()).toBeFalsy();
    expect(isTextInputActive(document.createElement("textarea"))).toBeFalsy();
  });

  it("excludes the one field named, and only that one", () => {
    const slot = focus("textarea");
    expect(isTextInputActive(slot)).toBe(false);
    expect(isTextInputActive()).toBe(true);

    const other = focus("textarea");
    expect(other).toBe(document.activeElement);
    expect(isTextInputActive(slot)).toBe(true);
  });
});
