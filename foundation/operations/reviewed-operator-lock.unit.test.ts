import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  REVIEWED_OPERATOR_LOCK_KEY_HIGH,
  REVIEWED_OPERATOR_LOCK_KEY_LOW,
} from "./reviewed-operator-lock";

/**
 * R-6 from the independent review. The organisation reference load and the
 * ADR-0021 D5 first-administrator ceremony took advisory locks under the same
 * high key but different low keys, so each excluded a second copy of itself and
 * neither excluded the other.
 *
 * This is asserted on source text because it cannot be asserted behaviourally
 * without a test that deliberately blocks: `pg_advisory_xact_lock` waits rather
 * than failing, and both tools take their lock inside a transaction they own. A
 * test that held the lock and then invoked a tool would hang the suite rather
 * than fail it.
 */

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** Collapses formatting so the assertions survive a reformat but not a rewrite. */
function normalise(source: string): string {
  return source.replace(/\s+/g, " ");
}

const loadSource = readSource("../organisation-reference/organisation-load.ts");
const ceremonySource = readSource(
  "../authentication/first-administrator-ceremony.ts",
);
const localBootstrapSource = readSource(
  "../authentication/local-first-administrator-bootstrap.ts",
);

const SHARED_LOCK_CALL =
  "SELECT pg_advisory_xact_lock(${REVIEWED_OPERATOR_LOCK_KEY_HIGH}, ${REVIEWED_OPERATOR_LOCK_KEY_LOW})";

describe("the reviewed operator tools share one advisory lock", () => {
  test("both tools take the shared lock, and neither keeps a key of its own", () => {
    for (const [label, source] of [
      ["organisation reference load", loadSource],
      ["first-administrator ceremony", ceremonySource],
    ] as const) {
      expect(normalise(source), `${label} must take the shared lock`).toContain(
        SHARED_LOCK_CALL,
      );
      // A local constant is how the two drifted apart in the first place: each
      // was written on a different day and took that day's date as its low key.
      expect(source, `${label} must not redeclare a lock key`).not.toMatch(
        /const ADVISORY_LOCK_KEY_(HIGH|LOW)\s*=/,
      );
      expect(
        source,
        `${label} must not inline a literal lock key`,
      ).not.toMatch(/pg_advisory_xact_lock\(\s*\d/);
    }
  });

  test("the key is a pair, so it cannot collide with the single-argument locks", () => {
    // `quarterly-reviews/development-seed.ts` and migration 017 both use the
    // one-argument form, which occupies a different lock space entirely.
    expect(Number.isInteger(REVIEWED_OPERATOR_LOCK_KEY_HIGH)).toBe(true);
    expect(Number.isInteger(REVIEWED_OPERATOR_LOCK_KEY_LOW)).toBe(true);
  });

  /**
   * Deliberately NOT unified. The local bootstrap runs only in local
   * development, which the D5 ceremony can never reach, so the two cannot
   * collide however long either holds a transaction open — and it is one of the
   * local-only guard files this work does not touch.
   */
  test("the local bootstrap keeps its own key and is left alone", () => {
    expect(localBootstrapSource).toContain(
      "pg_advisory_xact_lock(1112691796, 1398034993)",
    );
    expect(localBootstrapSource).not.toContain("reviewed-operator-lock");
    expect(REVIEWED_OPERATOR_LOCK_KEY_LOW).not.toBe(1398034993);
  });
});
