import { createReadStream } from 'fs'
import { lstat, readdir } from 'fs/promises'
import { basename, join } from 'path'
import { PassThrough, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { createDeflateRaw } from 'zlib'

const ZIP_LOCAL_FILE_HEADER = 0x04034b50
const ZIP_DATA_DESCRIPTOR = 0x08074b50
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_UTF8_FLAG = 0x0800
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008
const ZIP_DEFLATE_METHOD = 8
const ZIP_VERSION = 20
const ZIP_MAX_UINT16 = 0xffff
const ZIP_MAX_UINT32 = 0xffffffff

type ZipSourceEntry = {
    absolutePath: string
    archivePath: string
    isDirectory: boolean
    modifiedAt: Date
}

type ZipCentralEntry = {
    archivePath: string
    isDirectory: boolean
    modifiedAt: Date
    crc32: number
    compressedSize: number
    uncompressedSize: number
    localHeaderOffset: number
}

const CRC32_TABLE = buildCrc32Table()

function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256)
    for (let i = 0; i < table.length; i++) {
        let value = i
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        table[i] = value >>> 0
    }
    return table
}

function updateCrc32(crc: number, data: Uint8Array): number {
    let value = crc
    for (let i = 0; i < data.length; i++) {
        value = CRC32_TABLE[(value ^ data[i]) & 0xff]! ^ (value >>> 8)
    }
    return value >>> 0
}

function archiveSegment(name: string): string {
    return name.replace(/\\/g, '_')
}

function normalizeArchiveRoot(name: string): string {
    const segment = archiveSegment(basename(name))
    if (segment === '' || segment === '.' || segment === '..') return 'workspace'
    return segment
}

async function collectDirectoryEntries(rootPath: string, archiveRootName: string): Promise<ZipSourceEntry[]> {
    const rootStat = await lstat(rootPath)
    if (!rootStat.isDirectory()) throw new Error('ZIP source must be a directory')

    const entries: ZipSourceEntry[] = [{
        absolutePath: rootPath,
        archivePath: normalizeArchiveRoot(archiveRootName) + '/',
        isDirectory: true,
        modifiedAt: rootStat.mtime,
    }]

    async function visit(directoryPath: string, archiveDirectoryPath: string): Promise<void> {
        const names = await readdir(directoryPath)
        names.sort(function (a, b) { return a.localeCompare(b) })
        for (let i = 0; i < names.length; i++) {
            const name = names[i]!
            const absolutePath = join(directoryPath, name)
            const entryStat = await lstat(absolutePath)
            if (entryStat.isSymbolicLink()) {
                throw new Error('Symbolic links cannot be downloaded in a ZIP archive')
            }
            const childArchivePath = archiveDirectoryPath + archiveSegment(name)
            if (entryStat.isDirectory()) {
                entries.push({
                    absolutePath,
                    archivePath: childArchivePath + '/',
                    isDirectory: true,
                    modifiedAt: entryStat.mtime,
                })
                await visit(absolutePath, childArchivePath + '/')
            } else if (entryStat.isFile()) {
                entries.push({
                    absolutePath,
                    archivePath: childArchivePath,
                    isDirectory: false,
                    modifiedAt: entryStat.mtime,
                })
            } else {
                throw new Error('Unsupported workspace entry cannot be downloaded in a ZIP archive')
            }
        }
    }

    await visit(rootPath, entries[0]!.archivePath)
    return entries
}

function dosDateTime(date: Date): { date: number, time: number } {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()))
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const seconds = Math.floor(date.getSeconds() / 2)
    return {
        date: ((year - 1980) << 9) | (month << 5) | day,
        time: (hours << 11) | (minutes << 5) | seconds,
    }
}

function localHeader(entry: ZipSourceEntry): Buffer {
    const name = Buffer.from(entry.archivePath, 'utf8')
    const dateTime = dosDateTime(entry.modifiedAt)
    const header = Buffer.alloc(30 + name.length)
    header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0)
    header.writeUInt16LE(ZIP_VERSION, 4)
    header.writeUInt16LE(ZIP_UTF8_FLAG | (entry.isDirectory ? 0 : ZIP_DATA_DESCRIPTOR_FLAG), 6)
    header.writeUInt16LE(entry.isDirectory ? 0 : ZIP_DEFLATE_METHOD, 8)
    header.writeUInt16LE(dateTime.time, 10)
    header.writeUInt16LE(dateTime.date, 12)
    header.writeUInt16LE(name.length, 26)
    name.copy(header, 30)
    return header
}

function dataDescriptor(crc32: number, compressedSize: number, uncompressedSize: number): Buffer {
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(ZIP_DATA_DESCRIPTOR, 0)
    descriptor.writeUInt32LE(crc32, 4)
    descriptor.writeUInt32LE(compressedSize, 8)
    descriptor.writeUInt32LE(uncompressedSize, 12)
    return descriptor
}

function centralDirectoryHeader(entry: ZipCentralEntry): Buffer {
    const name = Buffer.from(entry.archivePath, 'utf8')
    const dateTime = dosDateTime(entry.modifiedAt)
    const header = Buffer.alloc(46 + name.length)
    header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0)
    header.writeUInt16LE(0x0314, 4)
    header.writeUInt16LE(ZIP_VERSION, 6)
    header.writeUInt16LE(ZIP_UTF8_FLAG | (entry.isDirectory ? 0 : ZIP_DATA_DESCRIPTOR_FLAG), 8)
    header.writeUInt16LE(entry.isDirectory ? 0 : ZIP_DEFLATE_METHOD, 10)
    header.writeUInt16LE(dateTime.time, 12)
    header.writeUInt16LE(dateTime.date, 14)
    header.writeUInt32LE(entry.crc32, 16)
    header.writeUInt32LE(entry.compressedSize, 20)
    header.writeUInt32LE(entry.uncompressedSize, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(entry.isDirectory ? 0x41ed0010 : 0x81a40000, 38)
    header.writeUInt32LE(entry.localHeaderOffset, 42)
    name.copy(header, 46)
    return header
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
    const footer = Buffer.alloc(22)
    footer.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0)
    footer.writeUInt16LE(entryCount, 8)
    footer.writeUInt16LE(entryCount, 10)
    footer.writeUInt32LE(centralSize, 12)
    footer.writeUInt32LE(centralOffset, 16)
    return footer
}

function assertZip32(value: number, label: string): void {
    if (value > ZIP_MAX_UINT32) throw new Error(label + ' exceeds the ZIP32 limit')
}

export async function* createZipArchive(
    rootPath: string,
    archiveRootName: string,
): AsyncGenerator<Uint8Array> {
    const sources = await collectDirectoryEntries(rootPath, archiveRootName)
    if (sources.length > ZIP_MAX_UINT16) throw new Error('ZIP entry count exceeds the ZIP32 limit')

    const centralEntries: ZipCentralEntry[] = []
    let offset = 0

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i]!
        const headerOffset = offset
        const header = localHeader(source)
        offset += header.length
        yield header

        if (source.isDirectory) {
            centralEntries.push({
                archivePath: source.archivePath,
                isDirectory: true,
                modifiedAt: source.modifiedAt,
                crc32: 0,
                compressedSize: 0,
                uncompressedSize: 0,
                localHeaderOffset: headerOffset,
            })
            continue
        }

        let crc = 0xffffffff
        let uncompressedSize = 0
        let compressedSize = 0
        const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                crc = updateCrc32(crc, chunk)
                uncompressedSize += chunk.length
                callback(null, chunk)
            },
        })
        const compressed = new PassThrough()
        const compression = pipeline(createReadStream(source.absolutePath), meter, createDeflateRaw(), compressed)
        try {
            for await (const chunk of compressed) {
                const data = chunk as Buffer
                compressedSize += data.length
                offset += data.length
                yield data
            }
        } finally {
            await compression
        }

        assertZip32(compressedSize, 'Compressed file size')
        assertZip32(uncompressedSize, 'Uncompressed file size')
        const finalCrc = (crc ^ 0xffffffff) >>> 0
        const descriptor = dataDescriptor(finalCrc, compressedSize, uncompressedSize)
        offset += descriptor.length
        yield descriptor
        centralEntries.push({
            archivePath: source.archivePath,
            isDirectory: false,
            modifiedAt: source.modifiedAt,
            crc32: finalCrc,
            compressedSize,
            uncompressedSize,
            localHeaderOffset: headerOffset,
        })
    }

    const centralOffset = offset
    for (let i = 0; i < centralEntries.length; i++) {
        const header = centralDirectoryHeader(centralEntries[i]!)
        offset += header.length
        yield header
    }
    const centralSize = offset - centralOffset
    assertZip32(centralOffset, 'Central directory offset')
    assertZip32(centralSize, 'Central directory size')
    yield endOfCentralDirectory(centralEntries.length, centralSize, centralOffset)
}

export function downloadContentDisposition(fileName: string): string {
    const cleanName = fileName.replace(/[\r\n]/g, '_')
    const asciiName = cleanName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download'
    const encodedName = encodeURIComponent(cleanName).replace(/[!'()*]/g, function (char) {
        return '%' + char.charCodeAt(0).toString(16).toUpperCase()
    })
    return 'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedName
}
