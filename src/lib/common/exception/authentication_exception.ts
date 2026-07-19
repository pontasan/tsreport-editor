
export class AuthenticationException extends Error {
    message: string

    constructor() {
        super()
        this.message = ''
    }
}