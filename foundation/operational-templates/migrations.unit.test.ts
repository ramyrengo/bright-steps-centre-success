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

  test("grants the operational template bundle to Area Manager v3 only", () => {
    const capability = readFileSync(
      new URL("../migrations/024_operational_template_capabilities.up.sql", import.meta.url),
      "utf8",
    );
    for (const code of ["template.read", "template.create", "template.publish", "template.assign"]) {
      expect(capability).toContain(`('${code}'`);
      expect(capability).toContain(`('area_manager', 3, '${code}')`);
    }
    expect(capability).not.toMatch(/system_administrator',\s*\d+,\s*'template\./u);
  });
});
