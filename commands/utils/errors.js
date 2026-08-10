/**
 * Error raised for expected org-admin failures that callers can handle by code.
 */
export class OrgAdminError extends Error {
  /**
   * @param {string} code - Stable machine-readable error code.
   * @param {string} message - Human-readable error message.
   * @param {{ cause?: Error }} [options] - Optional error cause.
   */
  constructor (code, message, options = {}) {
    super(message, options)
    this.name = 'OrgAdminError'
    this.code = code
    Error.captureStackTrace?.(this, OrgAdminError)
  }
}

/**
 * Creates an invalid-input error.
 * @param {string} message - Validation failure description.
 * @returns {OrgAdminError}
 */
export function validationError (message) {
  return new OrgAdminError('VALIDATION_ERROR', message)
}
