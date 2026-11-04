export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor() {
    super("A valid employee authentication token is required.");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("A trusted service token is required for ticket writes.");
    this.name = "AuthorizationError";
  }
}
