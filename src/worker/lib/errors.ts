export type ErrorInfo = {
  cause?: Error;
  context?: Record<string, unknown>;
};

export class BusinessError extends Error {
  code: number;
  info: ErrorInfo;

  constructor(message: string, code = 400, info: ErrorInfo = {}) {
    super(message);
    this.name = "BusinessError";
    this.code = code;
    this.info = info;
  }
}
