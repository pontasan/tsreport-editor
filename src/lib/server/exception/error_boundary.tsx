'use client'

import { Component, ReactNode, useEffect } from "react"

type Props = {
    children?: ReactNode
}

type State = {
    hasError: boolean,
    error?: Error
}

/**
 * Implemented to handle exceptions thrown by server components.
 * ErrorBoundary is not supported by function components (getDerivedStateFromError),
 * so it is implemented as a class component.
 *
 * Reference:
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 *
 */
export default class ErrorBoundary extends Component<Props, State> {

    public state: State = {
        hasError: false,
        error: undefined
    }

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return {
            hasError: true,
            error
        }
    }

    public render() {
        if (this.state.hasError) {
            return <ErrorHandler error={this.state.error} />
        }

        return this.props.children
    }

}

/**
 * Converts an error caught by ErrorBoundary into an error message.
 * It might seem like you could simply catch the server component's exception, convert it,
 * and re-throw it — but that assumption is a big mistake.
 * The only exceptions ClientExceptionHandler can catch are those catchable via "unhandledrejection".
 * unhandledrejection can catch exceptions that occur within a Promise, but server components
 * and their parent element, Suspense, run on the server, so they cannot be caught by
 * ClientExceptionHandler, which runs on the client (and cannot run on the server).
 *
 * Fortunately, exceptions from Suspense can be caught by ErrorBoundary.
 *
 * @param props
 * @returns
 */
function ErrorHandler(props: {
    error?: Error
}) {
    useEffect(() => {
        if (props.error) {
            handleError(props.error)
        }
    }, [props.error])

    return undefined
}

async function handleError(error: Error) {
    throw error
}
