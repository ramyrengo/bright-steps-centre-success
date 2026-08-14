import type {
  OperationalChoiceOption,
  OperationalQuestionInput,
  OperationalSectionInput,
  OperationalTemplateContentInput,
  OperationalTemplateMetadata,
} from "./contracts";
import { OperationalTemplateError, requireOperationalTemplateUuid } from "./types";

const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const OPTION_VALUE = /^[a-z0-9][a-z0-9_.-]{0,99}$/u;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new OperationalTemplateError("invalid_input", `${field} is required`);
  }
  const normalised = value.trim();
  if (normalised.length < 1 || normalised.length > maximum || CONTROL_CHARACTER.test(normalised)) {
    throw new OperationalTemplateError(
      "invalid_input",
      `${field} must be between 1 and ${maximum} display-safe characters`,
    );
  }
  return normalised;
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, maximum);
}

function positiveOrder(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10_000) {
    throw new OperationalTemplateError("invalid_input", `${field} must be a positive integer`);
  }
  return Number(value);
}

function optionalBoundedInteger(
  value: unknown,
  field: string,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new OperationalTemplateError(
      "invalid_input",
      `${field} must be a whole number between 0 and ${maximum}`,
    );
  }
  return Number(value);
}

function choiceOptions(value: unknown, field: string): OperationalChoiceOption[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 50) {
    throw new OperationalTemplateError(
      "invalid_input",
      `${field} must contain between 2 and 50 options`,
    );
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new OperationalTemplateError("invalid_input", `${field}[${index}] is invalid`);
    }
    const option = candidate as Partial<OperationalChoiceOption>;
    const optionValue = typeof option.value === "string" ? option.value.trim() : "";
    if (!OPTION_VALUE.test(optionValue) || seen.has(optionValue)) {
      throw new OperationalTemplateError(
        "invalid_input",
        `${field} option values must be unique safe identifiers`,
      );
    }
    seen.add(optionValue);
    return {
      value: optionValue,
      label: requiredText(option.label, `${field}[${index}].label`, 100),
    };
  });
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OperationalTemplateError("invalid_input", `${field} must be a finite number`);
  }
  return value;
}

function optionalTime(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !LOCAL_TIME.test(value)) {
    throw new OperationalTemplateError("invalid_input", `${field} must use HH:MM`);
  }
  return value;
}

function validateQuestion(
  input: OperationalQuestionInput,
  sectionIndex: number,
  questionIndex: number,
): OperationalQuestionInput {
  const field = `sections[${sectionIndex}].questions[${questionIndex}]`;
  const base = {
    ...(input.id
      ? { id: requireOperationalTemplateUuid(input.id, `${field}.id`) }
      : {}),
    label: requiredText(input.label, `${field}.label`, 500),
    ...(optionalText(input.instructions, `${field}.instructions`, 1500)
      ? { instructions: optionalText(input.instructions, `${field}.instructions`, 1500) }
      : {}),
    order: positiveOrder(input.order, `${field}.order`),
    required: input.required,
  };
  if (typeof input.required !== "boolean") {
    throw new OperationalTemplateError("invalid_input", `${field}.required must be boolean`);
  }
  switch (input.type) {
    case "short_text":
    case "long_text": {
      const limit = input.type === "short_text" ? 500 : 5_000;
      const minLength = optionalBoundedInteger(input.minLength, `${field}.minLength`, limit);
      const maxLength = optionalBoundedInteger(input.maxLength, `${field}.maxLength`, limit);
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        throw new OperationalTemplateError("invalid_input", `${field} length range is invalid`);
      }
      return { ...base, type: input.type, ...(minLength !== undefined ? { minLength } : {}), ...(maxLength !== undefined ? { maxLength } : {}) };
    }
    case "single_choice":
      return { ...base, type: input.type, options: choiceOptions(input.options, `${field}.options`) };
    case "multiple_choice": {
      const options = choiceOptions(input.options, `${field}.options`);
      const minSelections = optionalBoundedInteger(input.minSelections, `${field}.minSelections`, options.length);
      const maxSelections = optionalBoundedInteger(input.maxSelections, `${field}.maxSelections`, options.length);
      if (minSelections !== undefined && maxSelections !== undefined && minSelections > maxSelections) {
        throw new OperationalTemplateError("invalid_input", `${field} selection range is invalid`);
      }
      return { ...base, type: input.type, options, ...(minSelections !== undefined ? { minSelections } : {}), ...(maxSelections !== undefined ? { maxSelections } : {}) };
    }
    case "numeric": {
      const minimum = optionalFiniteNumber(input.minimum, `${field}.minimum`);
      const maximum = optionalFiniteNumber(input.maximum, `${field}.maximum`);
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        throw new OperationalTemplateError("invalid_input", `${field} numeric range is invalid`);
      }
      return { ...base, type: input.type, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) };
    }
    case "time": {
      const earliest = optionalTime(input.earliest, `${field}.earliest`);
      const latest = optionalTime(input.latest, `${field}.latest`);
      if (earliest && latest && earliest >= latest) {
        throw new OperationalTemplateError("invalid_input", `${field} time range is invalid`);
      }
      return { ...base, type: input.type, ...(earliest ? { earliest } : {}), ...(latest ? { latest } : {}) };
    }
    default:
      throw new OperationalTemplateError("invalid_input", `${field}.type is not supported`);
  }
}

function validateMetadata(value: unknown): OperationalTemplateMetadata {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalTemplateError("invalid_input", "metadata must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > 20 || JSON.stringify(value).length > 10_000) {
    throw new OperationalTemplateError("invalid_input", "metadata is too large");
  }
  const metadata: OperationalTemplateMetadata = {};
  for (const [key, item] of entries) {
    if (!OPTION_VALUE.test(key) || !["string", "number", "boolean"].includes(typeof item) && item !== null) {
      throw new OperationalTemplateError("invalid_input", "metadata contains an unsupported key or value");
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new OperationalTemplateError("invalid_input", "metadata numbers must be finite");
    }
    metadata[key] = item as string | number | boolean | null;
  }
  return metadata;
}

export function validateOperationalTemplateContent(
  input: OperationalTemplateContentInput,
  options: { requireQuestions: boolean },
): OperationalTemplateContentInput {
  if (!Array.isArray(input.sections) || input.sections.length > 50) {
    throw new OperationalTemplateError("invalid_input", "sections must be a bounded list");
  }
  if (options.requireQuestions && input.sections.length === 0) {
    throw new OperationalTemplateError("invalid_state", "publish requires at least one section");
  }
  const sectionOrders = new Set<number>();
  const sectionIds = new Set<string>();
  let questionCount = 0;
  const sections: OperationalSectionInput[] = input.sections.map((section, sectionIndex) => {
    const field = `sections[${sectionIndex}]`;
    const order = positiveOrder(section.order, `${field}.order`);
    if (sectionOrders.has(order)) {
      throw new OperationalTemplateError("invalid_input", "section order values must be unique");
    }
    sectionOrders.add(order);
    const id = section.id ? requireOperationalTemplateUuid(section.id, `${field}.id`) : undefined;
    if (id && sectionIds.has(id)) {
      throw new OperationalTemplateError("invalid_input", "section IDs must be unique");
    }
    if (id) sectionIds.add(id);
    if (!Array.isArray(section.questions) || section.questions.length > 200) {
      throw new OperationalTemplateError("invalid_input", `${field}.questions must be a bounded list`);
    }
    const questionOrders = new Set<number>();
    const questionIds = new Set<string>();
    const questions = section.questions.map((question, questionIndex) => {
      const validated = validateQuestion(question, sectionIndex, questionIndex);
      if (questionOrders.has(validated.order)) {
        throw new OperationalTemplateError("invalid_input", `${field} question order values must be unique`);
      }
      questionOrders.add(validated.order);
      if (validated.id && questionIds.has(validated.id)) {
        throw new OperationalTemplateError("invalid_input", "question IDs must be unique within a section");
      }
      if (validated.id) questionIds.add(validated.id);
      questionCount += 1;
      return validated;
    });
    return {
      ...(id ? { id } : {}),
      title: requiredText(section.title, `${field}.title`, 150),
      ...(optionalText(section.instructions, `${field}.instructions`, 1000)
        ? { instructions: optionalText(section.instructions, `${field}.instructions`, 1000) }
        : {}),
      order,
      questions,
    };
  });
  if (questionCount > 500) {
    throw new OperationalTemplateError("invalid_input", "template questions exceed the supported limit");
  }
  if (options.requireQuestions && questionCount === 0) {
    throw new OperationalTemplateError("invalid_state", "publish requires at least one question");
  }
  return {
    title: requiredText(input.title, "title", 200),
    instructions: requiredText(input.instructions, "instructions", 2000),
    metadata: validateMetadata(input.metadata),
    sections,
  };
}

export function validateDailySchedule(input: {
  frequency: string;
  opensLocalTime: string;
  dueLocalTime: string;
  effectiveFrom: string;
}): void {
  if (input.frequency !== "DAILY") {
    throw new OperationalTemplateError("invalid_input", "only DAILY schedules are supported");
  }
  if (!LOCAL_TIME.test(input.opensLocalTime) || !LOCAL_TIME.test(input.dueLocalTime)) {
    throw new OperationalTemplateError("invalid_input", "schedule times must use HH:MM");
  }
  if (input.opensLocalTime >= input.dueLocalTime) {
    throw new OperationalTemplateError("invalid_input", "due time must be after opening time");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.effectiveFrom)) {
    throw new OperationalTemplateError("invalid_input", "effectiveFrom must use YYYY-MM-DD");
  }
  const parsed = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.effectiveFrom) {
    throw new OperationalTemplateError("invalid_input", "effectiveFrom is not a valid date");
  }
}
