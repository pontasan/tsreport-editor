import { describe, expect, test } from 'vitest'
import { ForbiddenException } from '../src/lib/common/exception/forbidden_exception'
import { WorkspaceAccessLogic, type WorkspaceAccess } from '../src/lib/server/logic/workspace_access_logic'

const OWN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OWNER_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const OWNER_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

function access(shares: WorkspaceAccess['shares']): WorkspaceAccess {
    return { ownWorkspaceKey: OWN, shares }
}

describe('WorkspaceAccessLogic.resolveAccess', function () {
    test('own workspace is always full read and write', function () {
        const a = access([])
        expect(WorkspaceAccessLogic.resolveAccess(a, OWN, '')).toEqual({ read: true, write: true })
        expect(WorkspaceAccessLogic.resolveAccess(a, OWN, 'any/deep/path.report')).toEqual({ read: true, write: true })
    })

    test('a foreign workspace with no share grants nothing', function () {
        const a = access([])
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'x')).toEqual({ read: false, write: false })
    })

    test('a read-only share covers the folder and its descendants only', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'designs', canRead: true, canWrite: false }])
        // At the shared folder and below: read yes, write no.
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'designs')).toEqual({ read: true, write: false })
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'designs/sub/a.report')).toEqual({ read: true, write: false })
        // A sibling or the owner's root is not covered.
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'other')).toEqual({ read: false, write: false })
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, '')).toEqual({ read: false, write: false })
        // "designsX" must not match the "designs" prefix.
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'designsX/a')).toEqual({ read: false, write: false })
    })

    test('a read+write share grants write', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'shared', canRead: true, canWrite: true }])
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'shared/x')).toEqual({ read: true, write: true })
    })

    test('shares are matched by their owner workspace key', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'p', canRead: true, canWrite: true }])
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_B, 'p')).toEqual({ read: false, write: false })
    })

    test('a traversal path is denied', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'designs', canRead: true, canWrite: true }])
        expect(WorkspaceAccessLogic.resolveAccess(a, OWN, '../escape')).toEqual({ read: false, write: false })
        expect(WorkspaceAccessLogic.resolveAccess(a, OWNER_A, 'designs/../../escape')).toEqual({ read: false, write: false })
    })
})

describe('WorkspaceAccessLogic.checkRead / checkWrite', function () {
    test('checkRead throws when not readable', function () {
        const a = access([])
        expect(function () { WorkspaceAccessLogic.checkRead(a, OWNER_A, 'x') }).toThrow(ForbiddenException)
        expect(function () { WorkspaceAccessLogic.checkRead(a, OWN, 'x') }).not.toThrow()
    })

    test('checkWrite throws on a read-only share', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'r', canRead: true, canWrite: false }])
        expect(function () { WorkspaceAccessLogic.checkWrite(a, OWNER_A, 'r/x') }).toThrow(ForbiddenException)
        expect(function () { WorkspaceAccessLogic.checkRead(a, OWNER_A, 'r/x') }).not.toThrow()
    })
})

describe('WorkspaceAccessLogic.mayTraverse', function () {
    test('own workspace is always traversable', function () {
        expect(WorkspaceAccessLogic.mayTraverse(access([]), OWN, '')).toBe(true)
        expect(WorkspaceAccessLogic.mayTraverse(access([]), OWN, 'deep/dir')).toBe(true)
    })

    test('a foreign directory is traversable when it leads to or contains a share', function () {
        const a = access([{ ownerWorkspaceKey: OWNER_A, path: 'a/b/c', canRead: true, canWrite: false }])
        // Root and ancestors on the way to the shared folder.
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, '')).toBe(true)
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, 'a')).toBe(true)
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, 'a/b')).toBe(true)
        // The shared folder itself and inside it.
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, 'a/b/c')).toBe(true)
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, 'a/b/c/d')).toBe(true)
        // An unrelated sibling directory is not traversable.
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_A, 'a/x')).toBe(false)
        expect(WorkspaceAccessLogic.mayTraverse(a, OWNER_B, '')).toBe(false)
    })
})
