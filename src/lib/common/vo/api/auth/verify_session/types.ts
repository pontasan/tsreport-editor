import { UserAccountVO } from "@/lib/common/vo/entity/user_account"

export namespace VerifySessionIF {

    export namespace POST {
        export type Request = {
        }

        export type Response = {
            isLoggedin: boolean,
            loginUser: UserAccountVO.Type
        }
    }

}