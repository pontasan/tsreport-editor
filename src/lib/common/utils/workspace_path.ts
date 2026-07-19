export function dirnamePosix(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    if (idx < 0) return ''
    return normalized.substring(0, idx)
}

export function hasUriScheme(value: string): boolean {
    const idx = value.indexOf(':')
    return idx > 0
}

export function normalizeWorkspacePath(path: string): string | null {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/')
    const stack: string[] = []
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (part === '' || part === '.') continue
        if (part === '..') {
            if (stack.length === 0) return null
            stack.pop()
            continue
        }
        stack.push(part)
    }
    return stack.join('/')
}

export function resolveWorkspacePath(baseDir: string, ref: string): string | null {
    const normalizedRef = ref.replace(/\\/g, '/')
    const raw = normalizedRef.startsWith('/')
        ? normalizedRef.substring(1)
        : (baseDir !== '' ? baseDir + '/' + normalizedRef : normalizedRef)
    return normalizeWorkspacePath(raw)
}
