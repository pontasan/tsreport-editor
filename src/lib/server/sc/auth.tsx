import { AuthenticationException } from '@/lib/common/exception/authentication_exception';
import { resolveSupportedLanguage } from '@/lib/common/i18n/languages';
import { AuthLogic } from '@/lib/server/logic/auth/auth_logic';
import { DbUtils } from '@/lib/server/utils/db_utils';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Auth(props: { lang: string }) {
    const cookieValues = await cookies()
    const token = cookieValues.get('token')?.value
    let redirectToLogin = false

    // For verification
    // console.log('*** Auth ***')

    if (token === undefined || token === '') {
        redirect(`/${resolveSupportedLanguage(props.lang)}`)
    }

    try {
        await DbUtils.transaction(async (client) => {
            // Check that the account exists
            await AuthLogic.checkToken(client, token)
        })
    } catch (e) {
        if (e instanceof AuthenticationException) {
            redirectToLogin = true
        } else {
            throw e
        }
    }

    if (redirectToLogin) {
        redirect(`/${resolveSupportedLanguage(props.lang)}`)
    }

    return undefined
}
