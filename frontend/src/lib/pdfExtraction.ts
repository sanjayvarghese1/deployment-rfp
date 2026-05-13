export type PdfExtractionMethod = "pdf-parse" | "ocr";

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  method: PdfExtractionMethod;
}

type PdfParseFn = (buffer: Buffer) => Promise<{
  text?: string;
  numpages?: number;
}>;

async function loadPdfParse(): Promise<PdfParseFn> {
  // pdf-parse v1 ships a CommonJS entrypoint in this path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfModule = require("pdf-parse/lib/pdf-parse.js");
  return (pdfModule.default || pdfModule) as PdfParseFn;
}

async function loadPdfJs(): Promise<any> {
  return await import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function loadTesseract(): Promise<any> {
  return await import("tesseract.js");
}

async function recognizeImage(imageBuffer: Buffer): Promise<string> {
  const tesseractModule: any = await loadTesseract();
  const recognize = tesseractModule.recognize || tesseractModule.default?.recognize;

  if (typeof recognize === "function") {
    const result = await recognize(imageBuffer, "eng", {
      logger: () => undefined,
    });
    return String(result?.data?.text || "").trim();
  }

  const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
  if (typeof createWorker !== "function") {
    throw new Error("Tesseract OCR is not available");
  }

  const worker = await createWorker("eng", 1, {
    logger: () => undefined,
  });

  try {
    if (typeof worker.loadLanguage === "function") {
      await worker.loadLanguage("eng");
    }
    if (typeof worker.initialize === "function") {
      await worker.initialize("eng");
    }

    const result = await worker.recognize(imageBuffer);
    return String(result?.data?.text || "").trim();
  } finally {
    if (typeof worker.terminate === "function") {
      await worker.terminate();
    }
  }
}

async function ocrPdfBuffer(buffer: Buffer, maxPages = 20): Promise<{ text: string; pageCount: number }> {
  const pdfjs = await loadPdfJs();
  // Load the native canvas binding only at runtime so Turbopack does not try to bundle it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas");
  const loadingTask = pdfjs.getDocument({
    data: buffer,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf.numPages || 0);
  const pageLimit = Math.min(totalPages, maxPages);
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({ canvasContext: context, viewport }).promise;

    const imageBuffer = canvas.toBuffer("image/png");
    const ocrText = await recognizeImage(imageBuffer);

    if (ocrText) {
      pageTexts.push(`--- Page ${pageNumber} ---\n${ocrText}`);
    }
  }

  return {
    text: pageTexts.join("\n\n").trim(),
    pageCount: totalPages,
  };
}

export async function extractPdfTextWithOcrFallback(buffer: Buffer, options?: { minTextChars?: number; maxOcrPages?: number }): Promise<PdfExtractionResult> {
  const minTextChars = options?.minTextChars ?? 60;
  const maxOcrPages = options?.maxOcrPages ?? 20;

  const pdfParse = await loadPdfParse();
  const parsed = await pdfParse(buffer);
  const extractedText = String(parsed?.text || "").trim();
  const pageCount = Number(parsed?.numpages || 0);

  if (extractedText.length >= minTextChars) {
    return {
      text: extractedText,
      pageCount,
      method: "pdf-parse",
    };
  }

  const ocrResult = await ocrPdfBuffer(buffer, maxOcrPages);
  const ocrText = ocrResult.text.trim();

  if (ocrText.length > extractedText.length) {
    return {
      text: ocrText,
      pageCount: ocrResult.pageCount || pageCount,
      method: "ocr",
    };
  }

  if (extractedText) {
    return {
      text: extractedText,
      pageCount,
      method: "pdf-parse",
    };
  }

  return {
    text: ocrText,
    pageCount: ocrResult.pageCount || pageCount,
    method: "ocr",
  };
}