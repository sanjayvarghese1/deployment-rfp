export async function extractTextFromPdf(file: File): Promise<string> {
  // Heuristic extraction for client-side previews when full parser is unavailable.
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const raw = new TextDecoder("latin1").decode(bytes);

  const chunks: string[] = [];
  const tjRegex = /\(([^()]*)\)\s*Tj/g;
  let tjMatch: RegExpExecArray | null;
  while ((tjMatch = tjRegex.exec(raw)) !== null) {
    if (tjMatch[1]) chunks.push(tjMatch[1]);
  }

  const tjArrayRegex = /\[((?:\([^\)]*\)\s*)+)\]\s*TJ/g;
  let arrMatch: RegExpExecArray | null;
  while ((arrMatch = tjArrayRegex.exec(raw)) !== null) {
    const parts = Array.from(arrMatch[1].matchAll(/\(([^()]*)\)/g)).map((m) => m[1]);
    if (parts.length > 0) chunks.push(parts.join(" "));
  }

  const text = chunks
    .join("\n")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text || "(Unable to extract text - try uploading again)";
}
