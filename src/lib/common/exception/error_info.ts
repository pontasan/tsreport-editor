
export type ErrorInfo = {
    message: string,
    statusCode?: number
}

export function create(): ErrorInfo {
    return {
        message: ''
    }
}