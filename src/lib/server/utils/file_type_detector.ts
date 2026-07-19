// File.


export type FileCategory = 'image' | 'video' | 'audio' | 'other'

export type FileTypeResult = {
    category: FileCategory
    mimeType: string
}

const OTHER: FileTypeResult = { category: 'other', mimeType: 'application/octet-stream' }

export function detectFileType(buffer: Buffer): FileTypeResult {
    const len = buffer.length
    if (len < 2) return OTHER

    const b0 = buffer[0]
    const b1 = buffer[1]

    // JPEG: FF D8 FF
    if (b0 === 0xFF && b1 === 0xD8 && len >= 3 && buffer[2] === 0xFF) {
        return { category: 'image', mimeType: 'image/jpeg' }
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b0 === 0x89 && b1 === 0x50 && len >= 8
        && buffer[2] === 0x4E && buffer[3] === 0x47
        && buffer[4] === 0x0D && buffer[5] === 0x0A
        && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return { category: 'image', mimeType: 'image/png' }
    }

    // GIF: 47 49 46 38
    if (b0 === 0x47 && b1 === 0x49 && len >= 4 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return { category: 'image', mimeType: 'image/gif' }
    }

    // BMP: 42 4D
    if (b0 === 0x42 && b1 === 0x4D) {
        return { category: 'image', mimeType: 'image/bmp' }
    }

    // TIFF (LE): 49 49 2A 00
    if (b0 === 0x49 && b1 === 0x49 && len >= 4 && buffer[2] === 0x2A && buffer[3] === 0x00) {
        return { category: 'image', mimeType: 'image/tiff' }
    }

    // TIFF (BE): 4D 4D 00 2A
    if (b0 === 0x4D && b1 === 0x4D && len >= 4 && buffer[2] === 0x00 && buffer[3] === 0x2A) {
        return { category: 'image', mimeType: 'image/tiff' }
    }

    // ICO: 00 00 01 00
    if (b0 === 0x00 && b1 === 0x00 && len >= 4 && buffer[2] === 0x01 && buffer[3] === 0x00) {
        return { category: 'image', mimeType: 'image/x-icon' }
    }

    // RIFF container: 52 49 46 46 + offset8 subtype
    if (b0 === 0x52 && b1 === 0x49 && len >= 12 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        // WebP: RIFF + WEBP
        if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return { category: 'image', mimeType: 'image/webp' }
        }
        // AVI: RIFF + AVI
        if (buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) {
            return { category: 'video', mimeType: 'video/x-msvideo' }
        }
        // WAV: RIFF + WAVE
        if (buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
            return { category: 'audio', mimeType: 'audio/wav' }
        }
    }

    // MP4/MOV: offset4 "ftyp"
    if (len >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        return { category: 'video', mimeType: 'video/mp4' }
    }

    // WebM/MKV: 1A 45 DF A3
    if (b0 === 0x1A && b1 === 0x45 && len >= 4 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
        return { category: 'video', mimeType: 'video/webm' }
    }

    // MP3 (ID3): 49 44 33
    if (b0 === 0x49 && b1 === 0x44 && len >= 3 && buffer[2] === 0x33) {
        return { category: 'audio', mimeType: 'audio/mpeg' }
    }

    // MP3 (sync): FF FB / FF F3 / FF F2
    if (b0 === 0xFF && (b1 === 0xFB || b1 === 0xF3 || b1 === 0xF2)) {
        return { category: 'audio', mimeType: 'audio/mpeg' }
    }

    // OGG: 4F 67 67 53
    if (b0 === 0x4F && b1 === 0x67 && len >= 4 && buffer[2] === 0x67 && buffer[3] === 0x53) {
        return { category: 'audio', mimeType: 'audio/ogg' }
    }

    // FLAC: 66 4C 61 43
    if (b0 === 0x66 && b1 === 0x4C && len >= 4 && buffer[2] === 0x61 && buffer[3] === 0x43) {
        return { category: 'audio', mimeType: 'audio/flac' }
    }

    // AAC (ADTS): FF F1 / FF F9
    if (b0 === 0xFF && (b1 === 0xF1 || b1 === 0xF9)) {
        return { category: 'audio', mimeType: 'audio/aac' }
    }

    // SVG: text <svg (first1024)
    
    const svgCheckLen = len < 1024 ? len : 1024
    let svgStart = 0
    // BOM (EF BB BF)
    
    if (len >= 3 && b0 === 0xEF && b1 === 0xBB && buffer[2] === 0xBF) {
        svgStart = 3
    }
    const text = buffer.toString('utf8', svgStart, svgCheckLen)
    if (text.indexOf('<svg') !== -1) {
        return { category: 'image', mimeType: 'image/svg+xml' }
    }

    return OTHER
}
