/**
 * Thrown when a requested resource does not exist (HTTP 404).
 * Used by the preview resource API where clients distinguish
 * "missing resource" from invalid requests.
 */
export class NotFoundException extends Error {
}
