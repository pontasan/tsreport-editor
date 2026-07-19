'use client'

import type { UiMessages } from '@/lib/common/i18n/ui_messages'
import { useSystem } from '@/lib/client/components/system/hooks'

export function useUiMessages(): UiMessages {
    const [state] = useSystem()
    return state.dictionary.ui
}
