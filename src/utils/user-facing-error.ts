export type UserFacingErrorStage =
  | "router"
  | "agent"
  | "search"
  | "refresh"
  | "select"
  | "checkout"
  | "discord_reply";

export class UserFacingError extends Error {
  readonly code: string;
  readonly stage: UserFacingErrorStage;
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      stage: UserFacingErrorStage;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = "UserFacingError";
    this.code = options.code;
    this.stage = options.stage;
    this.metadata = options.metadata;
  }
}

export const isUserFacingError = (value: unknown): value is UserFacingError => value instanceof UserFacingError;
