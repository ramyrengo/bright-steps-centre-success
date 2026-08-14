import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Layout contract for the Daily Success card.
 *
 * The rule guarded here is a semantic one rather than a visual one. A `<dl>`
 * that is itself a grid or flex container loses its term/description mapping in
 * the WebKit accessibility tree, so "Why / Overdue" is announced as two
 * unrelated strings and the reader is never told which is which. Nothing about
 * the rendered page looks wrong when that happens, which is exactly why it needs
 * a test on the stylesheet instead of an eye.
 */

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * Comments carry no braces, so a rule-matching pass swallows any comment
 * sitting above a rule into that rule's selector. Stripping them first is what
 * keeps `.daily-list > li` from being read as a comment followed by a selector.
 */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}]+)\{([^}]*)\}/gu)].map(
  ([, selector, body]) => ({
    selectors: selector.split(",").map((part) => part.trim()).filter(Boolean),
    body,
  }),
);

function block(selector: string): string {
  const index = css.indexOf(`${selector} {`);
  expect(index, `missing rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(index, css.indexOf("}", index));
}

describe("Daily Success layout contract", () => {
  test("the reason list is not itself a grid or flex container", () => {
    const rule = block(".daily-card__why");
    expect(rule).toContain("display: block");
    expect(rule).not.toMatch(/display:\s*(grid|flex|inline-grid|inline-flex|contents)/u);
  });

  test("pairs are spaced without relying on a grid gap", () => {
    // `gap` only applies to grid and flex containers, so removing the grid
    // silently removes the spacing unless it is replaced. This is the rule that
    // keeps the fix from being reverted for looking broken.
    expect(block(".daily-card__why > div + div")).toContain("margin-top");
    expect(block(".daily-card__why")).not.toContain("gap:");
  });

  test("the two-column layout lives on the wrapper, which has no semantics", () => {
    const rule = block(".daily-card__why div");
    expect(rule).toContain("display: grid");
    expect(rule).toContain("grid-template-columns: 4rem 1fr");
  });

  test("the card list is single column until there is room for more", () => {
    // Milestone 3A recorded that Daily Success mobile behaviour had no automated
    // evidence. The contract it relies on is phone-first: the base rule sets no
    // column template at all, so the list is one column, and the second column
    // is added only inside a min-width query. Written the other way round — wide
    // by default, narrowed later — a missed media query ships a two-column
    // layout to a 375px screen.
    const base = css.indexOf(".daily-list,\n.daily-centre-grid {");
    expect(base, "missing the base .daily-list rule").toBeGreaterThan(-1);
    const baseRule = css.slice(base, css.indexOf("}", base));
    expect(baseRule).toContain("display: grid");
    expect(baseRule).not.toContain("grid-template-columns");

    const widening = css.indexOf("@media (min-width: 48rem)", base);
    expect(widening, "the second column is not added after the base rule").toBeGreaterThan(base);
    expect(css.slice(widening, widening + 900)).toContain(
      ".daily-centre-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    );
  });

  test("a lone card spans the full width rather than leaving a gap", () => {
    const base = css.indexOf(".daily-list,\n.daily-centre-grid {");
    const widening = css.indexOf("@media (min-width: 48rem)", base);
    expect(css.slice(widening, widening + 900)).toContain(
      ".daily-list .daily-card:first-child:last-child { grid-column: 1 / -1; }",
    );
  });

  test("every level of the card can shrink below its content", () => {
    // This list has no `minmax(0, 1fr)` to fall back on, so the shrink chain is
    // doing that job instead: an implicit `auto` column is floored by its
    // content, and one long unbroken headline pans the whole page sideways if
    // any level of the chain loses `min-width: 0`.
    const granted = rules
      .filter((rule) => /min-width:\s*0/u.test(rule.body))
      .flatMap((rule) => rule.selectors);

    for (const selector of [".daily-list", ".daily-list > li", ".daily-card"]) {
      expect(granted, `${selector} must be able to shrink`).toContain(selector);
    }
  });

  test("no description-list element anywhere is given a grid or flex display", () => {
    // A broader guard than the single rule above: the same mistake made against
    // any other `dl`, `dt` or `dd` produces the same silent loss.
    const offenders = rules
      .filter((rule) => /display:\s*(grid|flex|inline-grid|inline-flex|contents)/u.test(rule.body))
      .flatMap((rule) => rule.selectors)
      .filter((selector) => /(^|[\s>+~])(dl|dt|dd)$/u.test(selector));

    expect(offenders).toEqual([]);
  });
});
