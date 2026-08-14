import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("operational template builder migrations", () => {
  test("extends the Centre Standards template and deployment lineage", () => {
    const schema = readFileSync(
      new URL("../migrations/023_area_manager_template_builder.up.sql", import.meta.url),
      "utf8",
    );
    expect(schema).toContain("ALTER TABLE audit_template_versions");
    expect(schema).toContain("CREATE TABLE operational_template_drafts");
    expect(schema).toContain("CREATE TABLE operational_template_draft_sections");
    expect(schema).toContain("CREATE TABLE operational_template_draft_questions");
    expect(schema).toContain("REFERENCES audit_template_versions");
    expect(schema).toContain("CREATE TABLE operational_template_assignments");
    expect(schema).toContain("REFERENCES operational_standard_deployments");
    expect(schema).toContain("frequency = 'DAILY'");
    expect(schema).toContain("centre_timezone");
    expect(schema).not.toMatch(/CREATE TABLE (?:forms|form_versions|form_responses)/u);
  });

  test("keeps released content immutable and publication attributable", () => {
    const schema = readFileSync(
      new URL("../migrations/023_area_manager_template_builder.up.sql", import.meta.url),
      "utf8",
    );
    const lifecycleState = readFileSync(
      new URL("../migrations/025_operational_template_lifecycle_state.up.sql", import.meta.url),
      "utf8",
    );
    expect(schema).toContain("published_at");
    expect(schema).toContain("published_by_principal_id");
    expect(schema).toContain("released audit template versions are immutable");
    expect(schema).toContain("published operational template versions require publication attribution");
    expect(schema).toContain("retired_by_principal_id");
    expect(lifecycleState).toContain("ALTER COLUMN status SET DEFAULT 'active'");
    expect(lifecycleState).toContain("ALTER COLUMN status SET DEFAULT 'draft'");
    expect(lifecycleState).toContain("ALTER COLUMN status SET DEFAULT 'DRAFT'");
    expect(lifecycleState).toContain("audit_template_versions_operational_publication_state_check");
    expect(lifecycleState).toContain("operational template lifecycle state cannot be null");
  });

  test("admits a date question at every boundary that enumerates question types", () => {
    // The scope gap this closes was a schema one: 023 wrote two CHECK
    // constraints and both stop at `time`. Neither may be edited — they are
    // applied, and golang-migrate tracks version numbers only — so 031 replaces
    // them. If a third boundary ever enumerates the types, this test is where
    // the omission should surface.
    const source = readFileSync(
      new URL("../migrations/023_area_manager_template_builder.up.sql", import.meta.url),
      "utf8",
    );
    const enumerations = source.match(
      /'short_text',\s*'long_text',\s*'single_choice',?\s*\n?\s*'multiple_choice',\s*'numeric',\s*'time'/gu,
    );
    expect(enumerations).toHaveLength(2);

    const dateQuestion = readFileSync(
      new URL("../migrations/031_operational_template_date_question.up.sql", import.meta.url),
      "utf8",
    );
    // Forward-only. 023 keeps its six; 031 supplies the seventh.
    expect(source).not.toContain("'date'");
    for (const table of ["operational_template_draft_questions", "audit_template_items"]) {
      expect(dateQuestion).toContain(`ALTER TABLE ${table}`);
      expect(dateQuestion).toContain(`WHERE conrelid = '${table}'::regclass`);
      expect(dateQuestion).toContain(`ADD CONSTRAINT ${table}_question_type_check`);
    }
    // Located by what it constrains, never by a generated name.
    expect(dateQuestion).toContain("pg_get_constraintdef(oid) LIKE '%question_type%'");
    // A silent zero-drop would widen the contract over a schema that still
    // refuses the type, so the migration counts what it dropped.
    expect(dateQuestion).toMatch(/IF dropped <> 1 THEN\s+RAISE EXCEPTION/u);
    // Every previously supported type survives alongside the new one.
    for (const type of ["short_text", "long_text", "single_choice", "multiple_choice",
                        "numeric", "time", "date"]) {
      expect(dateQuestion).toContain(`'${type}'`);
    }
    // Quarterly review items share `audit_template_items` and carry no question
    // type, so the published-side CHECK has to stay nullable.
    expect(dateQuestion).toContain("question_type IS NULL OR question_type IN");
    // A plain calendar date. No timezone machinery is reused for it.
    expect(dateQuestion).not.toContain("centre_timezone TEXT");
    expect(dateQuestion).not.toContain("TIMESTAMPTZ");
  });

  test("grants the operational template bundle to Area Manager v3 only", () => {
    // Centre Budgets claims `area_manager` version 3 in migration 026, which is
    // released and immutable. 024 therefore only registers the capability codes
    // and 030 folds them into the version 026 created. The bundle still reaches
    // Area Manager version 3 and still reaches nothing else.
    const registration = readFileSync(
      new URL("../migrations/024_operational_template_capabilities.up.sql", import.meta.url),
      "utf8",
    );
    const grant = readFileSync(
      new URL(
        "../migrations/030_operational_template_bundle_reconciliation.up.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const code of ["template.read", "template.create", "template.publish", "template.assign"]) {
      expect(registration).toContain(`('${code}'`);
      expect(grant).toContain(`('area_manager', 3, '${code}')`);
    }
    for (const migration of [registration, grant]) {
      expect(migration).not.toMatch(/system_administrator',\s*\d+,\s*'template\./u);
    }
    // The reconciliation only holds while 024 claims no canonical version of its
    // own. Reinstating that insert would collide with 026 all over again.
    expect(registration).not.toContain("INSERT INTO canonical_role_templates");
    expect(grant).not.toContain("INSERT INTO canonical_role_templates");
  });
});
