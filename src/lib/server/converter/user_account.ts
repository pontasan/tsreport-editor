import { DateUtils } from "@/lib/common/utils/date_utils"
import { UserAccountVO } from "@/lib/common/vo/entity/user_account"
import { UserAccount } from "@/lib/server/entity/user_account"

export namespace UserAccountConverter {

    export function toVO(src: UserAccount.Type): UserAccountVO.Type {
        return {
            id: src.id,
            displayName: src.displayName,
            userId: src.userId,
            pw: '',
            provider: src.provider,
            email: src.email,
            workspaceKey: src.workspaceKey,
            adminFlag: src.adminFlag,
            mcpEnabled: src.mcpEnabled,
            defaultColorMode: src.defaultColorMode,

            createUser: src.createUser,
            updateUser: src.updateUser,
            creation: DateUtils.formatTime(src.creation),
            modification: DateUtils.formatTime(src.modification),
            version: src.version
        }
    }

}
