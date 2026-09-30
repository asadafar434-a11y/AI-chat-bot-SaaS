// У pdfmake нет описания типов, а нужна только малая часть: шрифты, запрет обращений вовне и сборка PDF в память.
declare module "pdfmake" {
  type FontFiles = { normal: string; bold: string; italics: string; bolditalics: string };
  const pdfmake: {
    setFonts(fonts: Record<string, FontFiles>): void;
    // Разрешить ли загрузку по адресу и чтение файла по пути: всё, что не шрифт, закрыто.
    setUrlAccessPolicy(policy: (url: string) => boolean): void;
    setLocalAccessPolicy(policy: (path: string) => boolean): void;
    createPdf(definition: object): { getBuffer(): Promise<Buffer> };
  };
  export default pdfmake;
}

declare module "pdfmake/fonts/Roboto.js" {
  const fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>;
  export default fonts;
}
