import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { splitPdfIntoChunks, getPdfPageCount } from '../pdf-split'

vi.mock('../logger', () => ({
    log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

async function createTestPdf(pageCount: number): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create()
    
    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.addPage([612, 792])
        page.drawText(`Page ${i + 1}`, { x: 50, y: 700 })
    }
    
    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
}

describe('splitPdfIntoChunks', () => {
    it('returns single chunk for PDF with fewer pages than chunk size', async () => {
        const pdfBuffer = await createTestPdf(2)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 3)
        
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toEqual(pdfBuffer)
    })

    it('returns single chunk for PDF with exactly chunk size pages', async () => {
        const pdfBuffer = await createTestPdf(3)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 3)
        
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toEqual(pdfBuffer)
    })

    it('splits PDF into correct number of chunks', async () => {
        const pdfBuffer = await createTestPdf(7)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 3)
        
        expect(chunks).toHaveLength(3)
    })

    it('creates chunks with correct page counts', async () => {
        const pdfBuffer = await createTestPdf(8)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 3)
        
        expect(await getPdfPageCount(chunks[0])).toBe(3)
        expect(await getPdfPageCount(chunks[1])).toBe(3)
        expect(await getPdfPageCount(chunks[2])).toBe(2)
    })

    it('uses default chunk size of 3', async () => {
        const pdfBuffer = await createTestPdf(6)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer)
        
        expect(chunks).toHaveLength(2)
    })

    it('handles single page PDF', async () => {
        const pdfBuffer = await createTestPdf(1)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 3)
        
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toEqual(pdfBuffer)
    })

    it('handles custom chunk size', async () => {
        const pdfBuffer = await createTestPdf(10)
        
        const chunks = await splitPdfIntoChunks(pdfBuffer, 5)
        
        expect(chunks).toHaveLength(2)
        expect(await getPdfPageCount(chunks[0])).toBe(5)
        expect(await getPdfPageCount(chunks[1])).toBe(5)
    })
})

describe('getPdfPageCount', () => {
    it('returns correct page count', async () => {
        const pdfBuffer = await createTestPdf(5)
        
        const count = await getPdfPageCount(pdfBuffer)
        
        expect(count).toBe(5)
    })

    it('returns 1 for single page PDF', async () => {
        const pdfBuffer = await createTestPdf(1)
        
        const count = await getPdfPageCount(pdfBuffer)
        
        expect(count).toBe(1)
    })
})
