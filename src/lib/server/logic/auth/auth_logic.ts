
import { AuthenticationException } from "@/lib/common/exception/authentication_exception"
import { ForbiddenException } from "@/lib/common/exception/forbidden_exception"
import { UserAccountDao } from "@/lib/server/dao/user_account"
import { UserAccount } from "@/lib/server/entity/user_account"
import { PasswordHash } from "@/lib/server/logic/password_hash"
import { ClientBase } from "pg"

export namespace AuthLogic {

    // Guards administrator-only APIs (user management, factory reset).
    export function checkAdmin(user: UserAccount.Type): void {
        if (!user.adminFlag) {
            throw new ForbiddenException()
        }
    }

    export async function checkAuth(client: ClientBase, userId: string, pass: string): Promise<UserAccount.Type> {
        const loginUser = await UserAccountDao.getLocalByUserIdForUpdate(client, userId)
        const verification = await PasswordHash.check(loginUser?.pw, pass)
        if (loginUser === undefined || !verification.valid) {
            throw new AuthenticationException()
        }
        if (verification.needsUpgrade) {
            loginUser.pw = await PasswordHash.create(pass)
            const count = await UserAccountDao.update(client, loginUser)
            if (count !== 1) {
                throw new AuthenticationException()
            }
            loginUser.version++
        }

        return loginUser
    }

    export async function checkToken(client: ClientBase, token: string): Promise<UserAccount.Type> {
        const loginUser = await UserAccountDao.getByActiveToken(client, token)

        if (loginUser === undefined) {
            throw new AuthenticationException()
        }

        return loginUser
    }

}
