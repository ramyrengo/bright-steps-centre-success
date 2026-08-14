import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type {
  CentreBudgetMonthRequest,
  CentreBudgetMonthResponse,
  PortfolioBudgetMonthRequest,
  PortfolioBudgetMonthResponse,
  RecordCentreBudgetActualRequest,
  RecordCentreBudgetActualResponse,
} from "./contracts";
import {
  buildCentreBudgetMonth,
  buildPortfolioBudgetMonth,
  CentreBudgetError,
  recordCentreBudgetActual,
} from "./service";

export interface CentreBudgetApiDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  buildCentreMonth: typeof buildCentreBudgetMonth;
  buildPortfolio: typeof buildPortfolioBudgetMonth;
  recordActual: typeof recordCentreBudgetActual;
}

const runtimeDependencies: CentreBudgetApiDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  buildCentreMonth: buildCentreBudgetMonth,
  buildPortfolio: buildPortfolioBudgetMonth,
  recordActual: recordCentreBudgetActual,
};

/**
 * Maps internal failures to safe API errors.
 *
 * `access_denied` deliberately produces the same response whether the centre
 * is outside the viewer's scope or does not exist, so a budget route cannot be
 * used to discover which centres an organisation runs.
 */
function toApiError(error: unknown): never {
  if (error instanceof CentreBudgetError) {
    if (error.code === "invalid_input") {
      throw APIError.invalidArgument("request is not valid");
    }
    if (error.code === "access_denied") {
      throw APIError.permissionDenied("resource is not available");
    }
    if (error.code === "centre_context_unavailable") {
      throw APIError.unavailable("centre budget could not be checked safely");
    }
  }
  throw APIError.unavailable("Centre Budgets is temporarily unavailable");
}

/** @internal Testable protected boundary. */
export async function loadCentreBudgetMonth(
  request: CentreBudgetMonthRequest,
  dependencies: CentreBudgetApiDependencies = runtimeDependencies,
): Promise<CentreBudgetMonthResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.buildCentreMonth({
      principalId: authData.userID,
      centreId: request.centreId,
      month: request.month,
    });
    return result.response;
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable protected boundary. */
export async function loadPortfolioBudgetMonth(
  request: PortfolioBudgetMonthRequest,
  dependencies: CentreBudgetApiDependencies = runtimeDependencies,
): Promise<PortfolioBudgetMonthResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.buildPortfolio({
      principalId: authData.userID,
      month: request.month,
    });
    return result.response;
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable protected boundary. */
export async function submitCentreBudgetActual(
  request: RecordCentreBudgetActualRequest,
  dependencies: CentreBudgetApiDependencies = runtimeDependencies,
): Promise<RecordCentreBudgetActualResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.recordActual({
      principalId: authData.userID,
      request,
    });
    return result.response;
  } catch (error) {
    return toApiError(error);
  }
}

// Every route below carries an explicit `Promise<T>` return annotation.
// Omitting it lets the generated client fall back to an untyped response,
// which has silently erased a response type in this repository before.

export const getPortfolioBudgetMonth = api(
  { expose: true, auth: true, method: "GET", path: "/centre-budgets/months/:month/portfolio" },
  (request: PortfolioBudgetMonthRequest): Promise<PortfolioBudgetMonthResponse> =>
    loadPortfolioBudgetMonth(request),
);

export const getCentreBudgetMonth = api(
  { expose: true, auth: true, method: "GET", path: "/centre-budgets/months/:month/centres/:centreId" },
  (request: CentreBudgetMonthRequest): Promise<CentreBudgetMonthResponse> =>
    loadCentreBudgetMonth(request),
);

export const createCentreBudgetActual = api(
  { expose: true, auth: true, method: "POST", path: "/centre-budgets/months/:month/centres/:centreId/actuals" },
  (request: RecordCentreBudgetActualRequest): Promise<RecordCentreBudgetActualResponse> =>
    submitCentreBudgetActual(request),
);
