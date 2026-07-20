export type ErrorParams = Record<string, string | number>;

export type ErrorInfo = {
  cause?: Error;
  context?: Record<string, unknown>;
  details?: Record<string, unknown>;
  /** i18next interpolation map for message key (e.g. { hostname, bytes }). */
  params?: ErrorParams;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
};

export class BusinessError extends Error {
  code: string;
  status: number;
  info: ErrorInfo;

  constructor(message: string, status = 400, code = "INVALID_REQUEST", info: ErrorInfo = {}) {
    super(message);
    this.name = "BusinessError";
    this.code = code;
    this.status = status;
    this.info = info;
  }
}
