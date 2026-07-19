'use client'

import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Progress } from '@/lib/client/components/progress/progress'
import { useSystem } from '@/lib/client/components/system/hooks'
import { Action, SharedInNode } from './action'
import FolderShareDialog from './folder_share_dialog'
import styles from './workspace_panel.module.css'

type FileEntry = Action.WorkspaceFileEntry

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.bmp', '.ico', '.tiff', '.tif'])

function getFileIconInfo(name: string): { icon: string, className: string } {
    if (name.endsWith('.report')) return { icon: 'pi pi-file-edit', className: styles.report }
    if (name.endsWith('.json')) return { icon: 'pi pi-code', className: styles.json }
    const dotIdx = name.lastIndexOf('.')
    if (dotIdx !== -1 && IMAGE_EXTENSIONS.has(name.slice(dotIdx).toLowerCase())) {
        return { icon: 'pi pi-image', className: styles.image }
    }
    return { icon: 'pi pi-file', className: '' }
}

type ConfirmTarget =
    | { type: 'DELETE_ENTRY', workspace: string, parentPath: string, entryName: string, isDirectory: boolean }
    | { type: 'REJECT_SHARE', shareId: number, label: string }

type FilePreview = {
    url: string
    category: 'image' | 'video' | 'audio'
    fileName: string
}

type PromptTarget =
    | { type: 'CREATE_DIR', workspace: string, parentPath: string }
    | { type: 'CREATE_REPORT', workspace: string, parentPath: string }
    | { type: 'CREATE_JSON', workspace: string, parentPath: string }
    | { type: 'RENAME_ENTRY', workspace: string, parentPath: string, oldName: string, isDirectory: boolean }

// Permissions for a workspaceKey/path pair: the own workspace always grants
// full access, a shared-in folder inherits the nearest matching grant.
type Perms = { canRead: boolean, canWrite: boolean, isOwn: boolean }

type Props = {
    onCreateReport: (workspace: string, parentPath: string, fileName: string) => Promise<void>
    onCreateJson: (workspace: string, parentPath: string, fileName: string) => Promise<void>
    onOpenReport: (workspace: string, filePath: string) => void
    onOpenJson: (workspace: string, filePath: string) => void
    onRenameFile: (workspace: string, oldPath: string, newPath: string) => void
    onDeleteFile: (workspace: string, filePath: string, isDirectory: boolean) => void
    onFileUploaded: (workspace: string) => void
    // When set (with a changing seq), reveal and reload the given folder so a
    // file created elsewhere (e.g. an auto-generated subreport) becomes visible.
    revealRequest: { workspace: string, path: string, seq: number } | null
    currentFile: { workspace: string, path: string } | null
}

function WsTooltip(props: { label: string, anchorRect: DOMRect }) {
    const ref = useRef<HTMLDivElement>(null)
    const centerX = props.anchorRect.left + props.anchorRect.width / 2
    const top = props.anchorRect.bottom + 6
    useEffect(function () {
        const el = ref.current
        if (el === null) return
        const rect = el.getBoundingClientRect()
        let left = centerX - rect.width / 2
        if (left < 4) left = 4
        if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - 4 - rect.width
        el.style.left = left + 'px'
        el.style.visibility = 'visible'
    })
    return createPortal(
        <div ref={ref} className={styles.tooltip} style={{ top, visibility: 'hidden' }}>{props.label}</div>,
        document.body
    )
}

export default function WorkspacePanel(props: Props) {
    const [system] = useSystem()
    const ui = system.dictionary.ui

    function formatMessage(message: string, values: Record<string, string>): string {
        let result = message
        const keys = Object.keys(values)
        for (let i = 0; i < keys.length; i++) result = result.replace('{' + keys[i] + '}', values[keys[i]]!)
        return result
    }
    // Each account owns a single workspace identified by its workspaceKey.
    // Folders shared with the account by other owners appear as a separate group.
    const [ownKey, setOwnKey] = useState('')
    const [sharedIn, setSharedIn] = useState<SharedInNode[]>([])
    const [sharedOutPaths, setSharedOutPaths] = useState<Set<string>>(() => new Set())
    const [shareTargetPath, setShareTargetPath] = useState<string | null>(null)

    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
    const [entries, setEntries] = useState<Map<string, FileEntry[]>>(() => new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)
    const uploadTargetRef = useRef<{ workspace: string; path: string }>({ workspace: '', path: '' })

    const [filePreview, setFilePreview] = useState<FilePreview | null>(null)

    const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
    const [confirmMessage, setConfirmMessage] = useState('')
    const [promptTarget, setPromptTarget] = useState<PromptTarget | null>(null)
    const [promptMessage, setPromptMessage] = useState('')
    const [promptValue, setPromptValue] = useState('')
    const [loadingCount, setLoadingCount] = useState(0)
    const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set())
    const [hover, setHover] = useState<{ label: string, rect: DOMRect } | null>(null)

    function tip(label: string) {
        return {
            onMouseEnter: function (e: React.MouseEvent) {
                setHover({ label, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
            },
            onMouseLeave: function () { setHover(null) },
        }
    }

    // Fetch the workspace overview: own workspace, shared-in folders, and the own
    // folders that have been shared out (for the shared-out badge).
    function fetchTree() {
        Action.getWorkspaceTree().then(function (tree) {
            setOwnKey(tree.own.workspaceKey)
            setSharedIn(tree.sharedIn)
            setSharedOutPaths(new Set(tree.sharedOutPaths))
        })
    }

    useEffect(fetchTree, [])

    // Resolve the permissions for a workspaceKey/path pair.
    function permsFor(workspaceKey: string, path: string): Perms {
        if (workspaceKey === ownKey) return { canRead: true, canWrite: true, isOwn: true }
        let best: SharedInNode | null = null
        for (let i = 0; i < sharedIn.length; i++) {
            const node = sharedIn[i]
            if (node.ownerWorkspaceKey !== workspaceKey) continue
            if (path === node.path || path.startsWith(node.path + '/')) {
                if (best === null || node.path.length > best.path.length) best = node
            }
        }
        if (best === null) return { canRead: false, canWrite: false, isOwn: false }
        return { canRead: best.canRead, canWrite: best.canWrite, isOwn: false }
    }

    // Fetch entries within a directory
    function fetchEntries(workspace: string, subPath: string) {
        const key = subPath === '' ? workspace : workspace + '/' + subPath
        setLoadingCount(function (c) { return c + 1 })
        setLoadingKeys(function (prev) { const next = new Set(prev); next.add(key); return next })
        Action.getEntries(workspace, subPath).then(function (result) {
            setEntries(function (prev) {
                const next = new Map(prev)
                next.set(key, result)
                return next
            })
            setLoadingCount(function (c) { return c - 1 })
            setLoadingKeys(function (prev) { const next = new Set(prev); next.delete(key); return next })
        }, function () {
            setLoadingCount(function (c) { return c - 1 })
            setLoadingKeys(function (prev) { const next = new Set(prev); next.delete(key); return next })
        })
    }

    function expandToPath(workspace: string, subPath: string) {
        setExpandedPaths(function (prev) {
            const next = new Set(prev)
            let currentPath = ''
            next.add(workspace)
            if (subPath !== '') {
                const segments = subPath.split('/')
                let i = 0
                while (i < segments.length) {
                    currentPath = currentPath === '' ? segments[i] : currentPath + '/' + segments[i]
                    next.add(workspace + '/' + currentPath)
                    i += 1
                }
            }
            return next
        })

        fetchEntries(workspace, '')
        if (subPath === '') return

        let currentPath = ''
        const segments = subPath.split('/')
        let i = 0
        while (i < segments.length) {
            currentPath = currentPath === '' ? segments[i] : currentPath + '/' + segments[i]
            fetchEntries(workspace, currentPath)
            i += 1
        }
    }

    // Reveal + reload a folder on request from the parent (e.g. after a
    // subreport auto-created its report file in that folder).
    const revealSeq = props.revealRequest !== null ? props.revealRequest.seq : -1
    useEffect(function () {
        if (props.revealRequest === null) return
        expandToPath(props.revealRequest.workspace, props.revealRequest.path)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealSeq])

    // Toggle expand/collapse of a path
    function toggleExpand(workspace: string, subPath: string) {
        const key = subPath === '' ? workspace : workspace + '/' + subPath
        setExpandedPaths(function (prev) {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
                // Fetch entries if not yet fetched
                if (!entries.has(key)) {
                    fetchEntries(workspace, subPath)
                }
            }
            return next
        })
    }

    // Refresh the entire viewer
    function handleRefresh() {
        fetchTree()
        // Re-fetch entries for all currently expanded paths. A workspaceKey is a
        // UUID (no slash), so the first slash separates it from the sub-path.
        expandedPaths.forEach(function (key) {
            const slashIndex = key.indexOf('/')
            if (slashIndex === -1) {
                fetchEntries(key, '')
            } else {
                fetchEntries(key.substring(0, slashIndex), key.substring(slashIndex + 1))
            }
        })
    }

    // Dialog display helper
    function showConfirm(message: string, target: ConfirmTarget) {
        setConfirmMessage(message)
        setConfirmTarget(target)
    }

    function hideConfirm() {
        setConfirmTarget(null)
        setConfirmMessage('')
    }

    function handleConfirmOk() {
        const target = confirmTarget
        hideConfirm()
        if (target === null) return
        if (target.type === 'REJECT_SHARE') {
            // Grantee declines a folder shared with them; refresh the tree so the
            // shared-in node disappears.
            Action.rejectIncomingShare(target.shareId).then(fetchTree)
            return
        }
        const entryPath = target.parentPath === '' ? target.entryName : target.parentPath + '/' + target.entryName
        Action.deleteEntry(target.workspace, entryPath).then(function () {
            fetchEntries(target.workspace, target.parentPath)
            props.onDeleteFile(target.workspace, entryPath, target.isDirectory)
        })
    }

    function showPrompt(message: string, target: PromptTarget) {
        setPromptMessage(message)
        setPromptTarget(target)
        setPromptValue('')
    }

    function hidePrompt() {
        setPromptTarget(null)
        setPromptMessage('')
        setPromptValue('')
    }

    function handlePromptOk() {
        const value = promptValue.trim()
        const target = promptTarget
        hidePrompt()
        if (value === '' || target === null) return
        if (target.type === 'CREATE_DIR') {
            const newPath = target.parentPath === '' ? value : target.parentPath + '/' + value
            Action.createDirectory(target.workspace, newPath).then(function () {
                // Expand down to the created directory's parent so the new
                // directory becomes visible in the tree.
                expandToPath(target.workspace, target.parentPath)
            })
        } else if (target.type === 'CREATE_REPORT') {
            const fullName = value.endsWith('.report') ? value : value + '.report'
            props.onCreateReport(target.workspace, target.parentPath, fullName).then(function () {
                expandToPath(target.workspace, target.parentPath)
            })
        } else if (target.type === 'CREATE_JSON') {
            const fullName = value.endsWith('.json') ? value : value + '.json'
            props.onCreateJson(target.workspace, target.parentPath, fullName).then(function () {
                expandToPath(target.workspace, target.parentPath)
            })
        } else if (target.type === 'RENAME_ENTRY') {
            const oldPath = target.parentPath === '' ? target.oldName : target.parentPath + '/' + target.oldName
            Action.renameEntry(target.workspace, oldPath, value).then(function () {
                fetchEntries(target.workspace, target.parentPath)
                // If it's a directory, update the cache of child entries
                if (target.isDirectory) {
                    const oldKey = target.workspace + '/' + oldPath
                    const newPath = target.parentPath === '' ? value : target.parentPath + '/' + value
                    const newKey = target.workspace + '/' + newPath
                    setEntries(function (prev) {
                        const next = new Map<string, FileEntry[]>()
                        prev.forEach(function (v, k) {
                            if (k === oldKey) {
                                next.set(newKey, v)
                            } else if (k.startsWith(oldKey + '/')) {
                                next.set(newKey + k.substring(oldKey.length), v)
                            } else {
                                next.set(k, v)
                            }
                        })
                        return next
                    })
                    setExpandedPaths(function (prev) {
                        const next = new Set<string>()
                        prev.forEach(function (k) {
                            if (k === oldKey) {
                                next.add(newKey)
                            } else if (k.startsWith(oldKey + '/')) {
                                next.add(newKey + k.substring(oldKey.length))
                            } else {
                                next.add(k)
                            }
                        })
                        return next
                    })
                }
                // Notify open tabs of the path update
                const newPath = target.parentPath === '' ? value : target.parentPath + '/' + value
                props.onRenameFile(target.workspace, oldPath, newPath)
            })
        }
    }

    // Create a directory
    function handleCreateDir(workspace: string, parentPath: string) {
        showPrompt(ui.newDirectoryName, { type: 'CREATE_DIR', workspace: workspace, parentPath: parentPath })
    }

    // Create a new report file
    function handleCreateReport(workspace: string, parentPath: string) {
        showPrompt(ui.reportFileName, { type: 'CREATE_REPORT', workspace: workspace, parentPath: parentPath })
    }

    // Create a new JSON file
    function handleCreateJson(workspace: string, parentPath: string) {
        showPrompt(ui.jsonFileName, { type: 'CREATE_JSON', workspace: workspace, parentPath: parentPath })
    }

    // Start a file upload
    function handleUploadClick(workspace: string, path: string) {
        uploadTargetRef.current = { workspace, path }
        if (fileInputRef.current !== null) {
            fileInputRef.current.value = ''
            fileInputRef.current.click()
        }
    }

    // Execute a file upload
    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files === null || files.length === 0) return
        const { workspace, path } = uploadTargetRef.current
        Action.uploadFile(workspace, path, files[0]).then(function () {
            fetchEntries(workspace, path)
            props.onFileUploaded(workspace)
        })
    }

    // Delete a file or directory
    function handleDeleteEntry(workspace: string, parentPath: string, entryName: string, isDirectory: boolean) {
        const typeLabel = isDirectory ? ui.directory : ui.file
        showConfirm(formatMessage(ui.deleteEntryQuestion, { type: typeLabel, name: entryName }), { type: 'DELETE_ENTRY', workspace: workspace, parentPath: parentPath, entryName: entryName, isDirectory: isDirectory })
    }

    // Rename a file or directory
    function handleRenameEntry(workspace: string, parentPath: string, entryName: string, isDirectory: boolean) {
        showPrompt(ui.newName, { type: 'RENAME_ENTRY', workspace: workspace, parentPath: parentPath, oldName: entryName, isDirectory: isDirectory })
        setPromptValue(entryName)
    }

    // Open the folder-sharing dialog for an own-workspace folder.
    function handleOpenShare(path: string) {
        setShareTargetPath(path)
    }

    function hideShareDialog() {
        setShareTargetPath(null)
        // Re-read the tree so the shared-out badges reflect the latest state.
        fetchTree()
    }

    // Handle a file click
    function handleFileClick(workspace: string, parentPath: string, entryName: string) {
        if (entryName.endsWith('.report')) {
            const filePath = parentPath === '' ? entryName : parentPath + '/' + entryName
            props.onOpenReport(workspace, filePath)
            return
        }
        if (entryName.endsWith('.json')) {
            const filePath = parentPath === '' ? entryName : parentPath + '/' + entryName
            props.onOpenJson(workspace, filePath)
            return
        }
        const entryPath = parentPath === '' ? entryName : parentPath + '/' + entryName
        Action.getFileType(workspace, entryPath).then(function (info) {
            if (info.category === 'other') return
            const url = '/api/workspace/' + encodeURIComponent(workspace) + '/files/' + encodeURIComponent(entryPath)
            setFilePreview({ url: url, category: info.category, fileName: entryName })
        })
    }

    function hideFilePreview() {
        setFilePreview(null)
    }

    // Render the create/upload action buttons shared by workspace roots and
    // directory rows (only rendered where the account has write access).
    function renderCreateButtons(workspace: string, parentPath: string) {
        return (
            <>
                <button
                    className={styles.iconBtn}
                    {...tip(ui.newReport)}
                    onClick={function (e) { e.stopPropagation(); handleCreateReport(workspace, parentPath) }}
                >
                    <i className="pi pi-file-plus"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    {...tip(ui.newJson)}
                    onClick={function (e) { e.stopPropagation(); handleCreateJson(workspace, parentPath) }}
                >
                    <i className="pi pi-code"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    {...tip(ui.newDirectory)}
                    onClick={function (e) { e.stopPropagation(); handleCreateDir(workspace, parentPath) }}
                >
                    <i className="pi pi-folder-plus"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    {...tip(ui.fileUpload)}
                    onClick={function (e) { e.stopPropagation(); handleUploadClick(workspace, parentPath) }}
                >
                    <i className="pi pi-upload"></i>
                </button>
            </>
        )
    }

    // Render a file/directory entry
    function renderEntry(workspace: string, parentPath: string, entry: FileEntry, depth: number) {
        const entryPath = parentPath === '' ? entry.name : parentPath + '/' + entry.name
        const key = workspace + '/' + entryPath
        const isExpanded = expandedPaths.has(key)
        const childEntries = entries.get(key)
        const perms = permsFor(workspace, entryPath)

        if (entry.isDirectory) {
            const isSharedOut = perms.isOwn && sharedOutPaths.has(entryPath)
            return (
                <div key={entry.name}>
                    <div
                        className={styles.entryItem}
                        style={{ paddingLeft: (0.375 + depth * 0.75) + 'rem' }}
                        onClick={function () { toggleExpand(workspace, entryPath) }}
                    >
                        <span className={styles.expandToggle}>
                            {isExpanded ? '▼' : '▶'}
                        </span>
                        <i className={'pi pi-folder ' + styles.entryIcon + ' ' + styles.dir}></i>
                        <span className={styles.entryName} {...tip(entry.name)}>{entry.name}</span>
                        {isSharedOut && (
                            <i className={'pi pi-share-alt ' + styles.sharedBadge} {...tip(ui.shared)}></i>
                        )}
                        <span className={styles.entryActions}>
                            <a
                                className={styles.iconBtn}
                                href={Action.getWorkspaceDownloadUrl(workspace, entryPath)}
                                download
                                aria-label={formatMessage(ui.downloadAsZip, { name: entry.name })}
                                {...tip(ui.downloadZip)}
                                onClick={function (e) { e.stopPropagation() }}
                            >
                                <i className="pi pi-download"></i>
                            </a>
                            {perms.canWrite && renderCreateButtons(workspace, entryPath)}
                            {perms.isOwn && (
                                <button
                                    className={styles.iconBtn}
                                    {...tip(ui.share)}
                                    onClick={function (e) { e.stopPropagation(); handleOpenShare(entryPath) }}
                                >
                                    <i className="pi pi-share-alt"></i>
                                </button>
                            )}
                            {perms.canWrite && (
                                <button
                                    className={styles.iconBtn}
                                    {...tip(ui.rename)}
                                    onClick={function (e) { e.stopPropagation(); handleRenameEntry(workspace, parentPath, entry.name, true) }}
                                >
                                    <i className="pi pi-pencil"></i>
                                </button>
                            )}
                            {perms.canWrite && (
                                <button
                                    className={styles.iconBtn}
                                    {...tip(ui.delete)}
                                    onClick={function (e) { e.stopPropagation(); handleDeleteEntry(workspace, parentPath, entry.name, true) }}
                                >
                                    <i className="pi pi-trash"></i>
                                </button>
                            )}
                        </span>
                    </div>
                    {isExpanded && loadingKeys.has(key) && childEntries === undefined && (
                        <div className={styles.children}>
                            <div className={styles.loadingEntry} style={{ paddingLeft: (0.375 + (depth + 1) * 0.75) + 'rem' }}>
                                <i className={'pi pi-spin pi-spinner ' + styles.loadingSpinner}></i>
                                <span>{ui.loading}...</span>
                            </div>
                        </div>
                    )}
                    {isExpanded && childEntries !== undefined && (
                        <div className={styles.children}>
                            {childEntries.map(function (child) { return renderEntry(workspace, entryPath, child, depth + 1) })}
                        </div>
                    )}
                </div>
            )
        }

        const filePath = parentPath === '' ? entry.name : parentPath + '/' + entry.name
        const isActive = props.currentFile !== null
            && props.currentFile.workspace === workspace
            && props.currentFile.path === filePath

        const fileIcon = getFileIconInfo(entry.name)

        return (
            <div key={entry.name}>
                <div
                    className={styles.entryItem + (isActive ? ' ' + styles.active : '')}
                    style={{ paddingLeft: (0.375 + depth * 0.75) + 'rem' }}
                    onClick={function () { handleFileClick(workspace, parentPath, entry.name) }}
                >
                    <span className={styles.expandPlaceholder} />
                    <i className={fileIcon.icon + ' ' + styles.entryIcon + (fileIcon.className !== '' ? ' ' + fileIcon.className : '')}></i>
                    <span className={styles.entryName} {...tip(entry.name)}>{entry.name}</span>
                    <span className={styles.entryActions}>
                        <a
                            className={styles.iconBtn}
                            href={Action.getWorkspaceDownloadUrl(workspace, filePath)}
                            download
                            aria-label={formatMessage(ui.downloadFile, { name: entry.name })}
                            {...tip(ui.download)}
                            onClick={function (e) { e.stopPropagation() }}
                        >
                            <i className="pi pi-download"></i>
                        </a>
                        {perms.canWrite && (
                            <>
                                <button
                                    className={styles.iconBtn}
                                    {...tip(ui.rename)}
                                    onClick={function (e) { e.stopPropagation(); handleRenameEntry(workspace, parentPath, entry.name, false) }}
                                >
                                    <i className="pi pi-pencil"></i>
                                </button>
                                <button
                                    className={styles.iconBtn}
                                    {...tip(ui.delete)}
                                    onClick={function (e) { e.stopPropagation(); handleDeleteEntry(workspace, parentPath, entry.name, false) }}
                                >
                                    <i className="pi pi-trash"></i>
                                </button>
                            </>
                        )}
                    </span>
                </div>
            </div>
        )
    }

    // Render the own workspace root node. Its name is the filesystem root "/".
    function renderOwnRoot() {
        const isExpanded = expandedPaths.has(ownKey)
        const wsEntries = entries.get(ownKey)

        return (
            <div>
                <div
                    className={styles.wsItem}
                    onClick={function () { toggleExpand(ownKey, '') }}
                >
                    <span className={styles.expandToggle}>
                        {isExpanded ? '▼' : '▶'}
                    </span>
                    <i className={'pi pi-folder ' + styles.wsIcon}></i>
                    <span className={styles.wsName} {...tip('/')}>/</span>
                    <span className={styles.wsActions}>
                        <a
                            className={styles.iconBtn}
                            href={Action.getWorkspaceDownloadUrl(ownKey, '')}
                            download
                            aria-label={ui.downloadWorkspaceZip}
                            {...tip(ui.downloadWorkspaceZip)}
                            onClick={function (e) { e.stopPropagation() }}
                        >
                            <i className="pi pi-download"></i>
                        </a>
                        {renderCreateButtons(ownKey, '')}
                    </span>
                </div>
                {isExpanded && loadingKeys.has(ownKey) && wsEntries === undefined && (
                    <div className={styles.children}>
                        <div className={styles.loadingEntry} style={{ paddingLeft: '1.125rem' }}>
                            <i className={'pi pi-spin pi-spinner ' + styles.loadingSpinner}></i>
                            <span>{ui.loading}...</span>
                        </div>
                    </div>
                )}
                {isExpanded && wsEntries !== undefined && (
                    <div className={styles.children}>
                        {wsEntries.map(function (entry) { return renderEntry(ownKey, '', entry, 0) })}
                    </div>
                )}
            </div>
        )
    }

    // Render a folder shared with the account by another owner. Same base look
    // and operability as the own workspace root; only a share icon and a muted
    // owner label distinguish it as external.
    function renderSharedNode(node: SharedInNode) {
        const key = node.ownerWorkspaceKey + '/' + node.path
        const isExpanded = expandedPaths.has(key)
        const nodeEntries = entries.get(key)
        const baseName = node.path.indexOf('/') !== -1
            ? node.path.substring(node.path.lastIndexOf('/') + 1)
            : node.path

        return (
            <div key={node.id}>
                <div
                    className={styles.wsItem}
                    onClick={function () { toggleExpand(node.ownerWorkspaceKey, node.path) }}
                >
                    <span className={styles.expandToggle}>
                        {isExpanded ? '▼' : '▶'}
                    </span>
                    <i className={'pi pi-folder ' + styles.wsIcon}></i>
                    <span className={styles.wsName} {...tip(formatMessage(ui.sharedBy, { owner: node.ownerLabel }) + ' / ' + baseName)}>{baseName}</span>
                    <i className={'pi pi-share-alt ' + styles.sharedBadge} {...tip(formatMessage(ui.sharedBy, { owner: node.ownerLabel }))}></i>
                    <span className={styles.sharedOwner}>{node.ownerLabel}</span>
                    <span className={styles.wsActions}>
                        <a
                            className={styles.iconBtn}
                            href={Action.getWorkspaceDownloadUrl(node.ownerWorkspaceKey, node.path)}
                            download
                            aria-label={formatMessage(ui.downloadAsZip, { name: baseName })}
                            {...tip(ui.downloadZip)}
                            onClick={function (e) { e.stopPropagation() }}
                        >
                            <i className="pi pi-download"></i>
                        </a>
                        {node.canWrite && renderCreateButtons(node.ownerWorkspaceKey, node.path)}
                        <button
                            className={styles.iconBtn}
                            {...tip(ui.removeSharedFolder)}
                            onClick={function (e) {
                                e.stopPropagation()
                                showConfirm(formatMessage(ui.removeSharedQuestion, { name: baseName, owner: node.ownerLabel }), { type: 'REJECT_SHARE', shareId: node.id, label: baseName })
                            }}
                        >
                            <i className="pi pi-times"></i>
                        </button>
                    </span>
                </div>
                {isExpanded && loadingKeys.has(key) && nodeEntries === undefined && (
                    <div className={styles.children}>
                        <div className={styles.loadingEntry} style={{ paddingLeft: '1.125rem' }}>
                            <i className={'pi pi-spin pi-spinner ' + styles.loadingSpinner}></i>
                            <span>{ui.loading}...</span>
                        </div>
                    </div>
                )}
                {isExpanded && nodeEntries !== undefined && (
                    <div className={styles.children}>
                        {nodeEntries.map(function (entry) { return renderEntry(node.ownerWorkspaceKey, node.path, entry, 0) })}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                <span>{ui.workspace}</span>
                <span className={styles.headerActions}>
                    <button className={styles.iconBtn} {...tip(ui.refresh)} onClick={handleRefresh}>
                        <i className="pi pi-refresh"></i>
                    </button>
                </span>
            </div>
            <div className={styles.tree}>
                {ownKey !== '' && renderOwnRoot()}
                {sharedIn.length > 0 && (
                    <>
                        <div className={styles.sectionDivider}>{ui.sharedFolders}</div>
                        {sharedIn.map(renderSharedNode)}
                    </>
                )}
            </div>
            <input
                ref={fileInputRef}
                type="file"
                className={styles.fileInput}
                onChange={handleFileChange}
            />

            <Dialog
                header={ui.confirm}
                visible={confirmTarget !== null}
                onHide={hideConfirm}
                style={{ width: '24rem' }}
                footer={
                    <div className={styles.dialogFooter}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={hideConfirm} />
                        <Button label={ui.ok} severity="danger" size="small" onClick={handleConfirmOk} />
                    </div>
                }
            >
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{confirmMessage}</p>
            </Dialog>

            <Dialog
                header={ui.input}
                visible={promptTarget !== null}
                onHide={hidePrompt}
                style={{ width: '24rem' }}
                footer={
                    <div className={styles.dialogFooter}>
                        <Button label={ui.cancel} severity="secondary" size="small" onClick={hidePrompt} />
                        <Button label={ui.ok} size="small" onClick={handlePromptOk} />
                    </div>
                }
            >
                <p style={{ margin: '0 0 0.5rem 0' }}>{promptMessage}</p>
                <InputText
                    value={promptValue}
                    onChange={function (e) { setPromptValue(e.target.value) }}
                    onKeyDown={function (e) { if (e.key === 'Enter') handlePromptOk() }}
                    style={{ width: '100%' }}
                    autoFocus
                />
            </Dialog>

            <Dialog
                header={filePreview !== null ? filePreview.fileName : ''}
                visible={filePreview !== null}
                onHide={hideFilePreview}
                style={{ width: 'auto', maxWidth: '90vw' }}
            >
                {filePreview !== null && filePreview.category === 'image' && (
                    <img src={filePreview.url} alt={filePreview.fileName}
                         className={styles.previewImage} />
                )}
                {filePreview !== null && filePreview.category === 'video' && (
                    <video src={filePreview.url} controls
                           className={styles.previewVideo} />
                )}
                {filePreview !== null && filePreview.category === 'audio' && (
                    <audio src={filePreview.url} controls
                           className={styles.previewAudio} />
                )}
            </Dialog>

            <FolderShareDialog
                visible={shareTargetPath !== null}
                onHide={hideShareDialog}
                path={shareTargetPath ?? ''}
            />

            {loadingCount > 0 && <Progress />}
            {hover !== null && <WsTooltip label={hover.label} anchorRect={hover.rect} />}
        </div>
    )
}
