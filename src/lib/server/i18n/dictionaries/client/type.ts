import type { PrimeReactMessages, UiMessages } from '@/lib/common/i18n/ui_messages'

export type ClientDictionaryType = {
    // Messages for the system
    system: {
        exceptionTitle: string,
        consistencyExceptionMessage: string,
        forbiddenExceptionMessage: string,
        clientTimeoutExceptionMessage: string,
        gatewayTimeoutExceptionMessage: string,
        networkDisconnectionExceptionMessage: string,
        systemExceptionMessage: string
    }
    ui: UiMessages
    primeReact: PrimeReactMessages
}
