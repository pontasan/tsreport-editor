import { describe, expect, test } from 'vitest'
import { parentWorkspacePath, workspaceActivityRevealPath, type WorkspaceActivityEvent } from '../src/lib/common/workspace_activity_event'

function event(overrides: Partial<WorkspaceActivityEvent>): WorkspaceActivityEvent {
    return {
        workspace: 'workspace',
        path: 'promotion/quotation.report',
        previousPath: '',
        action: 'save',
        isDirectory: false,
        draftKind: '',
        content: '',
        account: 'admin',
        via: 'mcp',
        instance: '',
        at: '2026-07-19T00:00:00.000Z',
        ...overrides,
    }
}

describe('workspace activity paths', function () {
    test('returns the parent of root and nested files', function () {
        expect(parentWorkspacePath('quotation.report')).toBe('')
        expect(parentWorkspacePath('promotion/assets/logo.svg')).toBe('promotion/assets')
    })

    test('reveals the changed directory for file saves, deletes and renames', function () {
        expect(workspaceActivityRevealPath(event({ action: 'save' }))).toBe('promotion')
        expect(workspaceActivityRevealPath(event({ action: 'delete' }))).toBe('promotion')
        expect(workspaceActivityRevealPath(event({ action: 'rename', path: 'archive/quotation.report' }))).toBe('archive')
    })

    test('reveals a saved or renamed directory itself and the parent after deletion', function () {
        expect(workspaceActivityRevealPath(event({ path: 'promotion/assets', isDirectory: true }))).toBe('promotion/assets')
        expect(workspaceActivityRevealPath(event({ action: 'rename', path: 'archive/assets', isDirectory: true }))).toBe('archive/assets')
        expect(workspaceActivityRevealPath(event({ action: 'delete', path: 'promotion/assets', isDirectory: true }))).toBe('promotion')
    })
})
