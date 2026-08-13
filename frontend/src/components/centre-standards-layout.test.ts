import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Layout contract for the Centre Standards surfaces.
 *
 * These assertions guard the rules that actually prevent the two failures this
 * screen is prone to: a wide child panning a 375px page sideways, and a target
 * too small to hit one-handed. They are deliberately checks on the stylesheet
 * rather than a one-off measurement, so removing a rule fails the build instead
 * of silently regressing until someone next opens a phone.
 */

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const index = css.indexOf(`${selector} {`);
  expect(index, `missing rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(index, css.indexOf("}", index));
}

describe("Centre Standards layout contract", () => {
  test.each([
    [".answer-control__options"],
    [".standards-list"],
    [".check-actions"],
  ])("%s uses an explicit zero-minimum single column", (selector) => {
    // An implicit grid column is sized `auto`, which resolves to max-content
    // and pans the whole page sideways on a phone.
    expect(block(selector)).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  test.each([
    [".standards-check"],
    [".answer-control"],
    [".answer-option__body"],
    [".standards-card"],
    [".standards-responses li"],
  ])("%s allows its content to shrink", (selector) => {
    expect(block(selector)).toContain("min-width: 0");
  });

  test("the primary answer target exceeds the one-handed minimum", () => {
    // 3.5rem = 56px, above the 44px floor, because this control is used
    // standing up and in motion.
    expect(block(".answer-option")).toContain("min-height: 3.5rem");
  });

  test("step and card controls clear the 44px minimum", () => {
    expect(css).toContain(".check-actions__primary,\n.check-actions .button {\n  min-height: 3rem;");
    expect(block(".standards-card .button")).toContain("min-height: 3rem");
  });

  test("the selected answer carries a mark as well as a colour", () => {
    expect(css).toContain('.answer-option:has(input:checked) .answer-option__mark::after');
    expect(css).toContain('content: "✓"');
  });

  test("focus is visible on the label that acts as the target", () => {
    expect(block(".answer-option:has(input:focus-visible)")).toContain(
      "outline: 2px solid var(--focus-ring)",
    );
  });

  test("wide layouts are additive, so the phone case is the default", () => {
    const listRule = css.indexOf(".standards-list {");
    const mediaRule = css.indexOf("@media (min-width: 48rem)", listRule);
    expect(mediaRule).toBeGreaterThan(listRule);
    expect(css.slice(mediaRule, mediaRule + 260)).toContain("auto-fit");
  });

  test("forced-colors keeps every Centre Standards boundary visible", () => {
    const forced = css.lastIndexOf("@media (forced-colors: active)");
    const tail = css.slice(forced);
    for (const selector of [".answer-option", ".standards-card", ".completion-state"]) {
      expect(tail).toContain(selector);
    }
  });
});
