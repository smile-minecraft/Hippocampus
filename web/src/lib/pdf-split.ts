/**
 * lib/pdf-split.ts
 * PDF splitting utility for chunking large PDFs into smaller segments.
 *
 * Used to improve AI extraction quality by processing PDFs in smaller chunks
 * rather than sending the entire document at once.
 *
 * Uses pdf-lib for PDF manipulation (pure JavaScript, no native dependencies).
 */

import { PDFDocument } from "pdf-lib";
import { log } from "./logger";

/**
 * Splits a PDF into chunks of specified page count.
 *
 * @param pdfBuffer - The original PDF as a Buffer
 * @param chunkSize - Number of pages per chunk (default: 3)
 * @returns Array of Buffer objects, each containing a PDF chunk
 *
 * @example
 * const pdfBuffer = await fs.readFile('large.pdf');
 * const chunks = await splitPdfIntoChunks(pdfBuffer, 3);
 * // chunks.length === Math.ceil(totalPages / 3)
 */
export async function splitPdfIntoChunks(
    pdfBuffer: Buffer,
    chunkSize: number = 3,
): Promise<Buffer[]> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();

    if (totalPages <= chunkSize) {
        log.info("pdf-split", `PDF has ${totalPages} pages, no splitting needed`);
        return [pdfBuffer];
    }

    const chunks: Buffer[] = [];
    const totalChunks = Math.ceil(totalPages / chunkSize);

    log.info("pdf-split", `Splitting PDF into ${totalChunks} chunks`, {
        totalPages,
        chunkSize,
        totalChunks,
    });

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startPage = chunkIndex * chunkSize;
        const endPage = Math.min(startPage + chunkSize, totalPages);
        const pagesInChunk = endPage - startPage;

        const chunkDoc = await PDFDocument.create();
        const pageIndices = Array.from({ length: pagesInChunk }, (_, i) => startPage + i);
        const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach((page) => chunkDoc.addPage(page));

        const chunkBytes = await chunkDoc.save();
        const chunkBuffer = Buffer.from(chunkBytes);
        chunks.push(chunkBuffer);

        log.info("pdf-split", `Created chunk ${chunkIndex + 1}/${totalChunks}`, {
            pages: pagesInChunk,
            pageRange: `${startPage + 1}-${endPage}`,
            bufferSize: chunkBuffer.length,
        });
    }

    return chunks;
}

/**
 * Gets the page count of a PDF without loading the entire document into memory.
 *
 * @param pdfBuffer - The PDF as a Buffer
 * @returns Number of pages in the PDF
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    return srcDoc.getPageCount();
}
