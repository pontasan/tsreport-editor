// RFC 6749 Section 5.2 error for the OAuth token endpoint.
// The token endpoint must answer with {"error": "..."} JSON instead of the
// application's ErrorInfo format, so it carries the RFC error code.
export type OAuthTokenErrorCode = 'invalid_request' | 'invalid_client' | 'invalid_scope' | 'unsupported_grant_type'

export class OAuthTokenException extends Error {
    code: OAuthTokenErrorCode
    description: string

    constructor(code: OAuthTokenErrorCode, description: string) {
        super()
        this.code = code
        this.description = description
        this.message = code + ': ' + description
    }

}
