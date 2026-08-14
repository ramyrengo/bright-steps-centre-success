import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Daily Success API surface", () => {
  test("exposes exactly one authenticated read and no Daily Success mutation", () => {
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    expect(source.match(/= api\(/gu)).toHaveLength(1);
    expect(source).toContain('auth: true');
    expect(source).toContain('method: "GET"');
    expect(source).toContain('path: "/daily-success"');
    expect(source).not.toMatch(/method:\s*"(?:POST|PUT|PATCH|DELETE)"/gu);
  });

  test("contains no persistent Daily Success or free-form CTA storage seam", () => {
    const files = ["contracts.ts", "service.ts", "corrective-action-source.ts", "quarterly-review-source.ts", "people-access-source.ts", "operational-check-source.ts"];
    const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");
    expect(source).not.toMatch(/daily_tasks|daily_success_items|snooze|dismiss|materiali[sz]ed/giu);
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+daily|DELETE\s+FROM/giu);
  });
});
