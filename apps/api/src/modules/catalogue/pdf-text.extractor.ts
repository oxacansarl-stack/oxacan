import { ValidationError } from '@oxacan/shared-types';
import type { PdfTextItem } from './pdf-soumission.parser';

/** Upload limits for a soumission PDF (the largest corpus soumission is well under 1 MB). */
export const PDF_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 300,
  maxTextItems: 300_000,
  /** pdf.js runs on the API's event loop: give up on a document that takes longer than this. */
  maxMillis: 20_000,
};

/** A PDF starts with "%PDF-" (we do not accept the leading junk some readers tolerate). */
export const isPdf = (bytes: Buffer) => bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';

/**
 * Positioned text of every page, read with pdf.js 6 (pure JS, no shell-out, no native code, no
 * worker). Only the text layer is read: fonts are not installed as FontFace, XFA forms are off,
 * and this pdf.js no longer compiles font programs to JS, so a document cannot run code.
 */
export async function extractPdfText(bytes: Buffer): Promise<PdfTextItem[][]> {
  if (bytes.length > PDF_LIMITS.maxBytes) throw new ValidationError('The PDF exceeds the 10 MB limit.');
  if (!isPdf(bytes)) throw new ValidationError('The file is not a PDF.');

  const { getDocumentProxy } = await import('unpdf');
  const started = Date.now();
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may detach the buffer it is given: hand it a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new ValidationError('The PDF is password-protected.');
    throw new ValidationError('The PDF could not be read.');
  }

  try {
    if (pdf.numPages > PDF_LIMITS.maxPages) {
      throw new ValidationError(`The PDF has ${pdf.numPages} pages; at most ${PDF_LIMITS.maxPages} can be imported.`);
    }
    const pages: PdfTextItem[][] = [];
    let itemCount = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (Date.now() - started > PDF_LIMITS.maxMillis) throw new ValidationError('The PDF took too long to read.');
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height });
      }
      itemCount += items.length;
      if (itemCount > PDF_LIMITS.maxTextItems) throw new ValidationError('The PDF holds too much text to import.');
      pages.push(items);
      page.cleanup();
    }
    return pages;
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError('The PDF could not be read.');
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
