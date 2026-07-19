import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { BusinessException } from "@/lib/common/exception/business_exception";
import { NextRequest } from "next/server";

export namespace NextUtils {

    export function getCookie(cookies: RequestCookies, key: string): string {
        const value = cookies.get(key)?.value
        return value ? value : ''
    }

    // Reads a request body as text, refusing anything larger than maxBytes.
    // App Router route handlers impose no default body-size limit, so a JSON
    // print/MCP payload would otherwise be buffered into memory unbounded. The
    // declared Content-Length is a fast pre-check; the stream is then counted so
    // a missing or understated length cannot bypass the cap.
    export async function readBodyText(req: NextRequest, maxBytes: number): Promise<string> {
        const declared = req.headers.get('content-length')
        if (declared !== null && Number(declared) > maxBytes) {
            throw new BusinessException('リクエストボディが大きすぎます。')
        }
        const body = req.body
        if (body === null) {
            return ''
        }
        const reader = body.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        for (; ;) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }
            if (value !== undefined) {
                total += value.byteLength
                if (total > maxBytes) {
                    await reader.cancel()
                    throw new BusinessException('リクエストボディが大きすぎます。')
                }
                chunks.push(value)
            }
        }
        const decoder = new TextDecoder()
        let text = ''
        for (let i = 0; i < chunks.length; i++) {
            text += decoder.decode(chunks[i], { stream: i < chunks.length - 1 })
        }
        return text
    }

}