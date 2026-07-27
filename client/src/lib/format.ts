/**
 * Display formatting. Money arrives from the API as integer poisha and is only ever
 * converted to a decimal at the render boundary.
 */

export function formatBdt(poisha: number, locale: 'bn' | 'en' = 'bn'): string {
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(poisha / 100);
}

export function formatNumber(value: number, locale: 'bn' | 'en' = 'bn'): string {
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD').format(value);
}

/**
 * Countdown to auction close.
 *
 * Returns null once expired so callers can render a distinct "closed" state rather
 * than a misleading "0s remaining".
 */
export function timeRemaining(
  isoDate: string,
  locale: 'bn' | 'en' = 'bn',
): { text: string; urgent: boolean } | null {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const n = (v: number): string => formatNumber(v, locale);
  const unit =
    locale === 'bn'
      ? { d: 'দিন', h: 'ঘণ্টা', m: 'মিনিট', s: 'সেকেন্ড' }
      : { d: 'd', h: 'h', m: 'm', s: 's' };

  // Urgent inside the final 5 minutes — the window where anti-snipe extensions and
  // last-second bidding actually happen, so the UI should feel different.
  const urgent = ms <= 5 * 60 * 1000;

  if (days > 0) return { text: `${n(days)} ${unit.d} ${n(hours)} ${unit.h}`, urgent };
  if (hours > 0) return { text: `${n(hours)} ${unit.h} ${n(minutes)} ${unit.m}`, urgent };
  if (minutes > 0) return { text: `${n(minutes)} ${unit.m} ${n(seconds)} ${unit.s}`, urgent };
  return { text: `${n(seconds)} ${unit.s}`, urgent: true };
}

export function formatDate(isoDate: string, locale: 'bn' | 'en' = 'bn'): string {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate));
}

/**
 * Downscales and re-encodes an image in the browser before upload.
 *
 * A modern phone camera produces 4–8 MB files. On a rural 2G/3G connection that is
 * a minutes-long upload that will often simply fail. Compressing to ~1024px/JPEG-80
 * typically cuts it to 100–200 KB with no loss of diagnostic value, since the model
 * only ever sees a 224×224 crop.
 */
export async function compressImage(file: File, maxDimension = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file; // no canvas support — send the original rather than failing
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.8);
  });
}
