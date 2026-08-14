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
      {
        label: "Date checked",
        order: 7,
        required: true,
        type: "date",
        earliest: "2026-01-01",
        latest: "2026-12-31",
      },
    ],
  }],
};

/** One date question, so a case can state only what it is about. */
function dateQuestion(
  bounds: { earliest?: string; latest?: string },
): OperationalTemplateContentInput {
  return {
    title: "Date only",
    instructions: "One date question and nothing else.",
    sections: [{
      title: "Dates",
      order: 1,
      questions: [{ label: "Date checked", order: 1, required: true, type: "date", ...bounds }],
    }],
  };
}

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
      "date",
    ]);
    expect(result.metadata).toEqual({ owner: "operations", internal: true });
  });

  describe("date questions", () => {
    test("accepts a date question with both bounds, and keeps them verbatim", () => {
      const question = validateOperationalTemplateContent(
        dateQuestion({ earliest: "2026-01-01", latest: "2026-12-31" }),
        { requireQuestions: true },
      ).sections[0].questions[0];
      expect(question.type).toBe("date");
      // Verbatim, not re-derived through a Date: a bound that came back as
      // 2025-12-31 would mean the host's own zone had been applied to a value
      // that has none.
      expect(question).toMatchObject({ earliest: "2026-01-01", latest: "2026-12-31" });
    });

    test("accepts a date question with no bounds at all", () => {
      const question = validateOperationalTemplateContent(
        dateQuestion({}),
        { requireQuestions: true },
      ).sections[0].questions[0];
      expect(question.type).toBe("date");
      expect(question).not.toHaveProperty("earliest");
      expect(question).not.toHaveProperty("latest");
    });

    test.each([
      { name: "only an earliest bound", bounds: { earliest: "2026-03-01" } },
      { name: "only a latest bound", bounds: { latest: "2026-03-01" } },
      // A time range spans a single day and cannot be one instant; a date range
      // legitimately can, when the answer must fall on one named day.
      { name: "a single-day window", bounds: { earliest: "2026-03-01", latest: "2026-03-01" } },
    ])("accepts $name", ({ bounds }) => {
      expect(() => validateOperationalTemplateContent(dateQuestion(bounds), {
        requireQuestions: true,
      })).not.toThrow();
    });

    test("rejects an inverted date range", () => {
      expect(() => validateOperationalTemplateContent(
        dateQuestion({ earliest: "2026-12-31", latest: "2026-01-01" }),
        { requireQuestions: true },
      )).toThrow(/date range is invalid/u);
    });

    test.each([
      // Well-formed and impossible. A pattern test alone admits every one of
      // these, which is why the parsed value is round-tripped back to a string.
      { name: "a day that month does not have", value: "2026-02-30" },
      { name: "29 February in a common year", value: "2025-02-29" },
      { name: "a thirteenth month", value: "2026-13-01" },
      { name: "a zeroth day", value: "2026-03-00" },
      { name: "a zeroth month", value: "2026-00-10" },
    ])("rejects $name", ({ value }) => {
      expect(() => validateOperationalTemplateContent(dateQuestion({ earliest: value }), {
        requireQuestions: true,
      })).toThrow(/is not a real date/u);
    });

    test("accepts 29 February in a leap year", () => {
      expect(() => validateOperationalTemplateContent(dateQuestion({ earliest: "2024-02-29" }), {
        requireQuestions: true,
      })).not.toThrow();
    });

    test.each([
      { name: "a timestamp", value: "2026-03-01T00:00:00.000Z" },
      { name: "a zone offset", value: "2026-03-01+10:00" },
      { name: "an unpadded month", value: "2026-3-01" },
      { name: "a time of day", value: "09:30" },
      { name: "an empty string", value: "" },
    ])("rejects $name as a date bound", ({ value }) => {
      expect(() => validateOperationalTemplateContent(dateQuestion({ earliest: value }), {
        requireQuestions: true,
      })).toThrow(/must use YYYY-MM-DD/u);
    });
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
