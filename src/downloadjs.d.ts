declare module 'downloadjs' {
  export default function download(
    data: string | Blob | ArrayBuffer | ArrayBufferView,
    filename?: string,
    mimeType?: string,
  ): void;
}

