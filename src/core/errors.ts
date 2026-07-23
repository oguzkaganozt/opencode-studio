export class StudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = "StudioError"
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } }
}
