import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Layout contract for the Template & Form Builder surfaces.
 *
 * These are assertions on the stylesheet rather than a one-off measurement, so
 * removing a rule fails the build instead of regressing silently until someone
 * next opens the builder on a phone. They guard the two failures these screens
 * are actually prone to: a wide child panning a 375px page sideways, and a
 * control too small to hit with a thumb.
 */

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * The same stylesheet with every comment blanked out to spaces.
 *
 * Lengths are preserved, so an index found here is an index into `css` itself.
 * Rules are located against this copy so that prose — which may legitimately
 * contain a brace, a semicolon or a class name — cannot be mistaken for part of
 * a selector.
 */
const scannable = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));

/** The selectors one rule serves, e.g. `.a, .b { … }` → `[".a", ".b"]`. */
function selectorsAt(brace: number): string[] {
  const start = Math.max(
    scannable.lastIndexOf("}", brace),
    scannable.lastIndexOf("{", brace - 1),
    scannable.lastIndexOf(";", brace),
  );
  return scannable
    .slice(start + 1, brace)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The declaration block of the first rule whose selector *list* contains
 * `selector`.
 *
 * Matching the whole list rather than the literal text `"<selector> {"` is the
 * point. `.builder-section-list, .builder-question-list { … }` is one rule
 * serving two selectors, and a helper that only looked for the literal text
 * would report the first of them as having no rule at all — a failure about how
 * the stylesheet is punctuated rather than about what it does.
 */
function block(selector: string): string {
  for (
    let brace = scannable.indexOf("{");
    brace !== -1;
    brace = scannable.indexOf("{", brace + 1)
  ) {
    if (selectorsAt(brace).includes(selector)) {
      return css.slice(brace, css.indexOf("}", brace));
    }
  }
  throw new Error(`missing rule for ${selector}`);
}

describe("Template builder layout contract", () => {
  test.each([
    [".template-list"],
    [".builder"],
    [".builder-section-list"],
    [".builder-question-list"],
    [".builder-field"],
    [".builder-field-row"],
    [".builder-choices__list"],
    [".version-history"],
    [".question-record-list"],
    [".centre-checklist"],
    [".phone-frame"],
    [".phone-preview"],
    [".entry-control"],
  ])("%s uses an explicit zero-minimum single column", (selector) => {
    // An implicit grid column is sized `auto`, which resolves to max-content
    // and pans the whole page sideways on a phone.
    expect(block(selector)).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  test.each([
    [".template-card"],
    [".builder"],
    [".builder-question__body"],
    [".builder-choice"],
    [".version-history__row"],
    [".question-record"],
    [".centre-checklist__item"],
    [".phone-frame__screen"],
    [".publish-summary"],
    [".builder-save-state"],
  ])("%s allows its content to shrink", (selector) => {
    expect(block(selector)).toContain("min-width: 0");
  });

  test("a typed answer is the same 56px target as a chosen one", () => {
    // The preview is the real educator control at the real size. A text box
    // half the height of the radio beside it would make the preview a lie
    // about the screen it is previewing.
    expect(css).toContain(
      ".entry-control__field input,\n.entry-control__field textarea {",
    );
    const rule = css.indexOf(".entry-control__field input,");
    expect(css.slice(rule, css.indexOf("}", rule))).toContain("min-height: 3.5rem");
  });

  test.each([
    [".order-controls__button"],
    [".builder-choice__remove"],
    [".builder-toggle"],
    [".centre-checklist__item"],
    [".assignment-picker__option"],
    [".builder-remove"],
  ])("%s clears the 44px minimum target", (selector) => {
    const rule = block(selector);
    expect(rule).toMatch(/min-height: 2\.75rem|height: 2\.75rem/);
  });

  test("the builder's own buttons clear the 44px minimum", () => {
    for (const selector of [".template-card .button", ".sticky-action-bar .button"]) {
      expect(block(selector)).toContain("min-height: 3rem");
    }
  });

  test("a fixed action bar reserves the space it covers", () => {
    // Without this the last control on the page sits underneath the bar and
    // cannot be reached at all on a phone.
    expect(block(".app-main:has(.sticky-action-bar)")).toContain("padding-bottom");
  });

  test("a multi-select answer is a square mark, not only a different colour", () => {
    // "Exactly one" and "any that apply" have to be distinguishable without
    // reading the legend, and without relying on colour.
    expect(block(".answer-option--multi .answer-option__mark")).toContain("border-radius: 6px");
  });

  test("wide layouts are additive, so the phone case is the default", () => {
    // The single-column rule is the base; the multi-column one only exists
    // inside a min-width query that comes after it. Written the other way
    // round, a phone would inherit the wide layout and have to undo it.
    const listRule = css.indexOf(".template-list {");
    const autoFit = css.indexOf("auto-fit", listRule);
    expect(autoFit, "the template list never widens").toBeGreaterThan(listRule);
    const enclosingMedia = css.lastIndexOf("@media (min-width:", autoFit);
    expect(enclosingMedia).toBeGreaterThan(listRule);
  });

  test("the phone preview is a real 375px column only where there is room", () => {
    const frame = css.indexOf(".phone-frame__screen {");
    const media = css.indexOf("@media (min-width: 48rem)", frame);
    expect(media).toBeGreaterThan(frame);
    // 23.4375rem = 375px, the narrowest verified breakpoint. On a phone the
    // preview is simply the page: a phone drawn inside a phone is a picture.
    expect(css.slice(media, media + 600)).toContain("23.4375rem");
  });

  test("forced-colors keeps every builder boundary visible", () => {
    const blocks = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)]
      .map((match) => match[1])
      .join("\n");
    for (const selector of [
      ".template-card",
      ".builder-question",
      ".centre-checklist__item",
      ".question-record",
      ".version-history__row",
      ".phone-frame__screen",
      ".order-controls__button",
    ]) {
      expect(blocks).toContain(selector);
    }
    // A disabled ordering control is conveyed by opacity, which forced-colors
    // discards outright — so it needs its own system colour.
    expect(blocks).toContain(".order-controls__button:disabled");
  });

  test("focus stays visible on the labels that act as targets", () => {
    for (const selector of [
      ".builder-toggle:has(input:focus-visible)",
      ".centre-checklist__item:has(input:focus-visible)",
      ".assignment-picker__option:has(input:focus-visible)",
    ]) {
      expect(block(selector)).toContain("outline: 2px solid var(--focus-ring)");
    }
  });

  test("the builder introduces no colour outside the Greenhouse tokens", () => {
    // Retheming is a change to the `:root` block and nothing else. A literal
    // hex anywhere in the builder section would quietly opt that surface out.
    const builderSection = css.slice(css.indexOf("Area Manager Template & Form Builder"));
    expect(builderSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
