import type { DailySuccessCta } from "./contracts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CONTROLLED_ROUTES = [
  /^\/area-manager$/u,
  /^\/compliance$/u,
  new RegExp(`^/area-manager/verification/${UUID}$`, "u"),
  new RegExp(`^/area-manager/centres/${UUID}/audit/${UUID}$`, "u"),
  new RegExp(`^/centre/actions/${UUID}$`, "u"),
  new RegExp(`^/centre/reviews/${UUID}$`, "u"),
  new RegExp(`^/admin/people/invitations/${UUID}$`, "u"),
] as const;

export class DailySuccessCtaError extends Error {
  constructor() {
    super("Daily Success CTA route is not controlled");
    this.name = "DailySuccessCtaError";
  }
}

export function controlledDailyCta(
  label: string,
  route: string,
): DailySuccessCta {
  if (
    label.trim().length === 0 ||
    !CONTROLLED_ROUTES.some((pattern) => pattern.test(route))
  ) {
    throw new DailySuccessCtaError();
  }
  return { label, route };
}
