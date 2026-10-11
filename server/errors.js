export class HttpError extends Error {
  constructor(status, message, code = 'request_failed') {
    super(message); this.name = 'HttpError'; this.status = status; this.code = code;
  }
}
export const fail = (status, message, code) => { throw new HttpError(status, message, code); };
export function validId(value, name = 'ID') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail(400, `${name} is invalid.`);
  return value;
}
