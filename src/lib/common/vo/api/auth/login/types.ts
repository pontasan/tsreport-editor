import { UserAccountVO } from "@/lib/common/vo/entity/user_account"

export namespace LoginIF {

    export namespace POST {
        export type Request = {
            userId: string,
            pass: string
        }

        export type Response = {
            loginUser: UserAccountVO.Type
        }
    }

}