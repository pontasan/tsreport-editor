const BINARY_ENCODING_KEY = '$tsreportBinaryEncoding'
const BINARY_DATA_KEY = 'data'
const ENCODE_CHUNK_SIZE = 32766

type BinaryEncoding = 'base64-uint8array-v1' | 'base64-float32array-v1' | 'base64-uint32array-v1'

type EncodedTypedArray = {
    [BINARY_ENCODING_KEY]: BinaryEncoding
    [BINARY_DATA_KEY]: string
}

/** Serializes report templates without expanding typed-array bytes into JSON properties. */
export function stringifyTemplateJson(value: unknown, space?: number): string {
    return JSON.stringify(value, function (_key, child: unknown): unknown {
        const encoding = typedArrayEncoding(child)
        if (encoding === null) return child
        const view = child as Uint8Array | Float32Array | Uint32Array
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        return {
            [BINARY_ENCODING_KEY]: encoding,
            [BINARY_DATA_KEY]: encodeBase64(bytes),
        } satisfies EncodedTypedArray
    }, space)
}

/** Restores report-template binary values serialized by stringifyTemplateJson. */
export function parseTemplateJson(text: string): unknown {
    return JSON.parse(text, function (_key, child: unknown): unknown {
        if (!isEncodedTypedArray(child)) return child
        const bytes = decodeBase64(child[BINARY_DATA_KEY])
        if (child[BINARY_ENCODING_KEY] === 'base64-uint8array-v1') return bytes
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        if (child[BINARY_ENCODING_KEY] === 'base64-float32array-v1') return new Float32Array(buffer)
        return new Uint32Array(buffer)
    })
}

function typedArrayEncoding(value: unknown): BinaryEncoding | null {
    if (value instanceof Uint8Array) return 'base64-uint8array-v1'
    if (value instanceof Float32Array) return 'base64-float32array-v1'
    if (value instanceof Uint32Array) return 'base64-uint32array-v1'
    return null
}

function isEncodedTypedArray(value: unknown): value is EncodedTypedArray {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    return keys.length === 2
        && (record[BINARY_ENCODING_KEY] === 'base64-uint8array-v1'
            || record[BINARY_ENCODING_KEY] === 'base64-float32array-v1'
            || record[BINARY_ENCODING_KEY] === 'base64-uint32array-v1')
        && typeof record[BINARY_DATA_KEY] === 'string'
}

function encodeBase64(bytes: Uint8Array): string {
    let result = ''
    for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK_SIZE) {
        const end = Math.min(offset + ENCODE_CHUNK_SIZE, bytes.length)
        const binary = String.fromCharCode.apply(null, bytes.subarray(offset, end) as unknown as number[])
        result += btoa(binary)
    }
    return result
}

function decodeBase64(encoded: string): Uint8Array {
    const binary = atob(encoded)
    const result = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        result[i] = binary.charCodeAt(i)
    }
    return result
}
