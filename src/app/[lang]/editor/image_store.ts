// Shared byte-level cache for editor image resources.
// The core layout engine resolves image data synchronously, while the browser
// can only fetch asynchronously. This store bridges the two worlds: the design
// canvas reads cached bytes synchronously (a cache miss starts a background
// fetch whose completion notifies subscribers), and the preview awaits the
// bytes through fetchImageBytes so it can lay out with real image sizes.

import { BusinessException } from '@/lib/common/exception/business_exception'
import { fetchProxy } from '@/lib/client/utils/fetch_proxy'

const imageBytesCache = new Map<string, Uint8Array | null>()
const inflightLoads = new Map<string, Promise<void>>()
const storeListeners = new Set<() => void>()
let storeVersion = 0

export function getImageStoreVersion(): number {
    return storeVersion
}

export function subscribeImageStore(listener: () => void): () => void {
    storeListeners.add(listener)
    return function () { storeListeners.delete(listener) }
}

// Returns cached bytes, null when the file does not exist on the server,
// or undefined when the bytes are not fetched yet (a background fetch starts).
export function requestImageBytes(url: string): Uint8Array | null | undefined {
    if (imageBytesCache.has(url)) return imageBytesCache.get(url)
    if (!inflightLoads.has(url)) {
        inflightLoads.set(url, loadImageBytes(url))
    }
    return undefined
}

// Resolves the bytes for a URL, fetching them first when not cached yet.
// A file missing on the server resolves to null (core onError semantics).
// A failed fetch rejects here so the caller's rejection reaches the client
// exception handler.
export async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
    if (imageBytesCache.has(url)) return imageBytesCache.get(url) as Uint8Array | null
    let inflight = inflightLoads.get(url)
    if (inflight === undefined) {
        inflight = loadImageBytes(url)
        inflightLoads.set(url, inflight)
    }
    await inflight
    return imageBytesCache.get(url) as Uint8Array | null
}

async function loadImageBytes(url: string): Promise<void> {
    try {
        const response = await fetchProxy(url)
        const buffer = await response.arrayBuffer()
        imageBytesCache.set(url, new Uint8Array(buffer))
    } catch (e) {
        if (e instanceof BusinessException) {
            // The workspace file API reports a nonexistent file as a business error.
            // Record it as a missing image resource so the core onError semantics
            // (icon / blank / error) decide how the report presents it.
            imageBytesCache.set(url, null)
        } else {
            throw e
        }
    } finally {
        inflightLoads.delete(url)
        notifyImageStore()
    }
}

function notifyImageStore(): void {
    storeVersion++
    storeListeners.forEach(function (listener) { listener() })
}
