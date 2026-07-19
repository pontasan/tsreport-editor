'use server'

import { CoreUtils } from '@/lib/common/utils/core_utils';
import { cookies } from 'next/headers';

export async function getCSRFToken() {
    const cookieStore = await cookies()
    const KEY_CSRF_TOKEN = 'csrf_token'

    if (cookieStore.has(KEY_CSRF_TOKEN) && !CoreUtils.isEmpty(cookieStore.get(KEY_CSRF_TOKEN))) {
        const csrfToken: string = cookieStore.get(KEY_CSRF_TOKEN)!.value
        return csrfToken
    }

    // Intentionally set a sufficiently long expiration to prioritize user experience.
    const expires = new Date()
    expires.setDate(expires.getDate() + 10)

    const csrfToken = CoreUtils.genUUID()
    cookieStore.set(KEY_CSRF_TOKEN, csrfToken, {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expires: expires.getTime()
    })

    return csrfToken
}