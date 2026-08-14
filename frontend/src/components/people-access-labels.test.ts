import { describe, expect, test } from "vitest";

import { historyActionLabel } from "./people-access-labels";

describe("access history wording", () => {
  test.each([
    ["invitation.created", "Invitation created"],
    ["invitation.sent", "Invitation sent"],
    ["invitation.resent", "Invitation resent"],
    ["invitation.cancelled", "Invitation cancelled"],
    ["invitation.expired", "Invitation expired"],
    ["invitation.activated", "Invitation accepted"],
    ["invitation.identity_review_required", "Identity review required"],
    ["principal.activated", "Access activated"],
    ["principal.reactivated", "Access reactivated"],
    ["principal.suspended", "Access suspended"],
    ["principal.revoked", "Access revoked"],
    ["role_assignment.granted", "Role granted"],
    ["role_assignment.ended", "Role ended"],
    ["role_assignment.bundle_migrated", "Role capabilities updated"],
    ["assignment_scope.replaced", "Assignment scope changed"],
    ["privileged_access.approved", "Privileged access approved"],
  ])("%s reads as %s", (action, expected) => {
    expect(historyActionLabel(action)).toBe(expected);
  });

  test("never shows a dotted machine code, mapped or not", () => {
    // The previous rendering replaced underscores and left everything else, so
    // the namespace and the internal noun order reached the reader intact.
    const actions = [
      "invitation.identity_review_required",
      "assignment_scope.replaced",
      "something.not_yet_mapped",
      "principal.some_future_event",
    ];
    for (const action of actions) {
      const label = historyActionLabel(action);
      expect(label).not.toContain(".");
      expect(label).not.toContain("_");
    }
  });

  test("an unmapped code still reads as a sentence", () => {
    // A labelling gap should look like a plain description, not like a leak.
    expect(historyActionLabel("principal.some_future_event")).toBe("Some future event");
    expect(historyActionLabel("membership.ended")).toBe("Ended");
  });

  test("degrades safely on input that carries no readable tail", () => {
    expect(historyActionLabel("")).toBe("Access change");
    expect(historyActionLabel("trailing.")).toBe("Access change");
  });

  test("every mapped label starts capitalised and stays short enough to scan", () => {
    for (const action of [
      "invitation.created",
      "role_assignment.bundle_migrated",
      "privileged_access.approved",
    ]) {
      const label = historyActionLabel(action);
      expect(label[0]).toBe(label[0]?.toUpperCase());
      expect(label.length).toBeLessThanOrEqual(40);
    }
  });
});
