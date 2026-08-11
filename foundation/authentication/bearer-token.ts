const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_ACCESS_TOKEN_LENGTH = 32_768;

export class BearerCredentialError extends Error {
  constructor() {
    super("bearer credential rejected");
    this.name = "BearerCredentialError";
  }
}

/** Accepts exactly one compact-JWT Bearer credential and no alternate form. */
export function parseBearerToken(authorization: unknown): string {
  if (typeof authorization !== "string") {
    throw new BearerCredentialError();
  }

  const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
  const token = match?.[1];
  if (
    token === undefined ||
    token.length > MAX_ACCESS_TOKEN_LENGTH ||
    !JWT_SHAPE.test(token)
  ) {
    throw new BearerCredentialError();
  }

  return token;
}

export function isCompactJwt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ACCESS_TOKEN_LENGTH &&
    JWT_SHAPE.test(value)
  );
}
