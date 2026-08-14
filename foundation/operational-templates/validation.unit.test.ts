import { describe, expect, test } from "vitest";
import type { OperationalTemplateContentInput } from "./contracts";
import { OperationalTemplateError } from "./types";
import { validateDailySchedule, validateOperationalTemplateContent } from "./validation";

const allTypes: OperationalTemplateContentInput = {
  title: "Opening readiness",
  instructions: "Complete this operational form before opening.",
  metadata: { owner: "operations", internal: true },
  sections: [{
    title: "Readiness",
    order: 1,
    questions: [
      { label: "Short note", order: 1, required: true, type: "short_text", maxLength: 120 },
      { label: "Long note", order: 2, required: false, type: "long_text", maxLength: 2_000 },
      {
        label: "Choose one",
        order: 3,
        required: true,
        type: "single_choice",
        options: [{ value: "ready", label: "Ready" }, { value: "not_ready", label: "Not ready" }],
      },
      {
        label: "Choose several",
        order: 4,
        required: false,
        type: "multiple_choice",
        options: [{ value: "inside", label: "Inside" }, { value: "outside", label: "Outside" }],
        maxSelections: 2,
      },
      { label: "Count", order: 5, required: true, type: "numeric", minimum: 0, maximum: 100 },
      { label: "Time checked", order: 6, required: true, type: "time", earliest: "06:00", latest: "10:00" },
    ],
  }],
};

describe("operational template validation", () => {
  test("accepts and normalises every authorised cycle-one question type", () => {
    const result = validateOperationalTemplateContent(allTypes, { requireQuestions: true });
    expect(result.sections[0].questions.map((question) => question.type)).toEqual([
      "short_text",
      "long_text",
      "single_choice",
      "multiple_choice",
      "numeric",
      "time",
    ]);
    expect(result.metadata).toEqual({ owner: "operations", internal: true });
  });

  test.each([
    {
      name: "duplicate choice values",
      mutate: (content: OperationalTemplateContentInput) => {
        content.sections[0].questions[2] = {
          label: "Choose one",
          order: 3,
          required: true,
          type: "single_choice",
          options: [{ value: "same", label: "One" }, { value: "same", label: "Two" }],
        };
      },
    },
    {
      name: "inverted numeric range",
      mutate: (content: OperationalTemplateContentInput) => {
        content.sections[0].questions[4] = {
          label: "Count",
          order: 5,
          required: true,
          type: "numeric",
          minimum: 10,
          maximum: 1,
        };
      },
    },
    {
      name: "control character in a label",
      mutate: (content: OperationalTemplateContentInput) => {
        content.sections[0].questions[0] = {
          label: "Unsafe\u0000label",
          order: 1,
          required: true,
          type: "short_text",
        };
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const content = structuredClone(allTypes);
    mutate(content);
    expect(() => validateOperationalTemplateContent(content, { requireQuestions: true }))
      .toThrow(OperationalTemplateError);
  });

  test("allows an incomplete draft but not an empty publication", () => {
    const draft = { ...allTypes, sections: [] };
    expect(validateOperationalTemplateContent(draft, { requireQuestions: false }).sections).toEqual([]);
    expect(() => validateOperationalTemplateContent(draft, { requireQuestions: true }))
      .toThrow(/publish requires at least one section/u);
  });

  test("accepts only minute-precision DAILY schedules", () => {
    expect(() => validateDailySchedule({
      frequency: "DAILY",
      opensLocalTime: "08:00",
      dueLocalTime: "17:30",
      effectiveFrom: "2026-08-14",
    })).not.toThrow();
    expect(() => validateDailySchedule({
      frequency: "WEEKLY",
      opensLocalTime: "08:00",
      dueLocalTime: "17:30",
      effectiveFrom: "2026-08-14",
    })).toThrow(/only DAILY/u);
    expect(() => validateDailySchedule({
      frequency: "DAILY",
      opensLocalTime: "17:30",
      dueLocalTime: "08:00",
      effectiveFrom: "2026-08-14",
    })).toThrow(/due time/u);
  });
});
