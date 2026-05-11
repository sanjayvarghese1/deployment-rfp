declare module "pdf-parse" {
  const pdfParse: (buffer: Buffer) => Promise<any>;

  export = pdfParse;
}