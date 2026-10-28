/** Phone photos are 3–12MB; Claude reads documents fine at ~2000px, so shrink before upload. */
const MAX_EDGE = 2000;
const MAX_PDF_BYTES = 20_000_000;

export interface UploadPage {
  data: string; // base64, no data: prefix
  mediaType: string;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function prepareFile(file: File): Promise<UploadPage> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('File PDF quá lớn (tối đa 20MB).');
    return { data: toBase64(await file.arrayBuffer()), mediaType: 'application/pdf' };
  }
  const img = await loadImage(file); // iOS converts HEIC to JPEG for web file inputs
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.85),
  );
  return { data: toBase64(await blob.arrayBuffer()), mediaType: 'image/jpeg' };
}
