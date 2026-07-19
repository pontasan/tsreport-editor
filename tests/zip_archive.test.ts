import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { inflateRawSync } from 'zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createZipArchive, downloadContentDisposition } from '../src/lib/server/utils/zip_archive'

type ParsedEntry = {
    name: string
    isDirectory: boolean
    data: Buffer
}

const temporaryDirectories: string[] = []

afterEach(async function () {
    for (let i = 0; i < temporaryDirectories.length; i++) {
        await rm(temporaryDirectories[i]!, { recursive: true, force: true })
    }
    temporaryDirectories.length = 0
})

async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'tsreport-zip-'))
    temporaryDirectories.push(directory)
    return directory
}

async function collectArchive(rootPath: string, archiveRootName: string): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of createZipArchive(rootPath, archiveRootName)) {
        chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

function findEndOfCentralDirectory(archive: Buffer): number {
    for (let offset = archive.length - 22; offset >= 0; offset--) {
        if (archive.readUInt32LE(offset) === 0x06054b50) return offset
    }
    throw new Error('End of central directory not found')
}

function parseArchive(archive: Buffer): ParsedEntry[] {
    const footerOffset = findEndOfCentralDirectory(archive)
    const entryCount = archive.readUInt16LE(footerOffset + 10)
    let centralOffset = archive.readUInt32LE(footerOffset + 16)
    const entries: ParsedEntry[] = []

    for (let i = 0; i < entryCount; i++) {
        expect(archive.readUInt32LE(centralOffset)).toBe(0x02014b50)
        const method = archive.readUInt16LE(centralOffset + 10)
        const compressedSize = archive.readUInt32LE(centralOffset + 20)
        const nameLength = archive.readUInt16LE(centralOffset + 28)
        const extraLength = archive.readUInt16LE(centralOffset + 30)
        const commentLength = archive.readUInt16LE(centralOffset + 32)
        const localOffset = archive.readUInt32LE(centralOffset + 42)
        const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8')

        expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50)
        const localNameLength = archive.readUInt16LE(localOffset + 26)
        const localExtraLength = archive.readUInt16LE(localOffset + 28)
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength
        const compressed = archive.subarray(dataOffset, dataOffset + compressedSize)
        const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed)
        entries.push({ name, isDirectory: name.endsWith('/'), data })
        centralOffset += 46 + nameLength + extraLength + commentLength
    }
    return entries
}

describe('workspace ZIP archive', function () {
    it('streams nested UTF-8 files and preserves empty directories', async function () {
        const root = await createTemporaryDirectory()
        await mkdir(join(root, '資料', 'empty'), { recursive: true })
        await writeFile(join(root, 'readme.txt'), 'root text', 'utf8')
        await writeFile(join(root, '資料', '見積書.report'), '{"name":"見積書"}', 'utf8')
        await writeFile(join(root, '資料', 'binary.dat'), Buffer.from([0, 1, 2, 255]))

        const archive = await collectArchive(root, '案件データ')
        const entries = parseArchive(archive)
        const byName = new Map(entries.map(function (entry) { return [entry.name, entry] }))

        expect(byName.get('案件データ/')?.isDirectory).toBe(true)
        expect(byName.get('案件データ/資料/')?.isDirectory).toBe(true)
        expect(byName.get('案件データ/資料/empty/')?.isDirectory).toBe(true)
        expect(byName.get('案件データ/readme.txt')?.data.toString('utf8')).toBe('root text')
        expect(byName.get('案件データ/資料/見積書.report')?.data.toString('utf8')).toBe('{"name":"見積書"}')
        expect(byName.get('案件データ/資料/binary.dat')?.data).toEqual(Buffer.from([0, 1, 2, 255]))
    })

    it('rejects symbolic links instead of archiving data outside the selected folder', async function () {
        const root = await createTemporaryDirectory()
        const outside = await createTemporaryDirectory()
        await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
        await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'))

        await expect(collectArchive(root, 'workspace')).rejects.toThrow('Symbolic links cannot be downloaded')
    })

    it('creates an ASCII fallback and an RFC 5987 UTF-8 filename', function () {
        const header = downloadContentDisposition('見積書 2026.report')
        expect(header).toContain('filename="___ 2026.report"')
        expect(header).toContain("filename*=UTF-8''%E8%A6%8B%E7%A9%8D%E6%9B%B8%202026.report")
    })
})
