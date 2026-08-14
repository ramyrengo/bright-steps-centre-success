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

  test("no description-list element anywhere is given a grid or flex display", () => {
    // A broader guard than the single rule above: the same mistake made against
    // any other `dl`, `dt` or `dd` produces the same silent loss.
    const offenders = [...css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/gu)]
      .filter(([, , selector, body]) => {
        const targetsDescriptionList = /(^|[\s,>+~])(dl|dt|dd)(\s*[,{]|\s*$|\s)/u.test(
          `${selector.trim()} `,
        );
        return (
          targetsDescriptionList &&
          /display:\s*(grid|flex|inline-grid|inline-flex|contents)/u.test(body)
        );
      })
      .map(([, , selector]) => selector.trim());

    expect(offenders).toEqual([]);
  });
});
