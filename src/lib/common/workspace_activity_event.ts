export type WorkspaceActivityEvent = {
    workspace: string
    path: string
    previousPath: string
    action: 'draft' | 'save' | 'delete' | 'rename'
    isDirectory: boolean
    draftKind: '' | 'report' | 'json'
    content: string
    account: string
    via: 'mcp' | 'editor'
    instance: string
    at: string
}

export function parentWorkspacePath(path: string): string {
    const slash = path.lastIndexOf('/')
    return slash === -1 ? '' : path.substring(0, slash)
}

export function workspaceActivityRevealPath(event: WorkspaceActivityEvent): string {
    if (event.action !== 'delete' && event.isDirectory) return event.path
    return parentWorkspacePath(event.path)
}

