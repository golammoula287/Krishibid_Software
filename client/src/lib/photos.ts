import { MAX_LISTING_PHOTOS, type ListingPhotoUploadResult } from '@krishibid/shared';
import { getAccessToken } from './api.js';
import { UploadError, type UploadProgress } from './signup.js';

/**
 * Uploading photographs of a lot, with real progress.
 *
 * `XMLHttpRequest` rather than `fetch`, for the same reason the signup documents use it: fetch
 * cannot report upload progress. Several megabytes of photographs on rural 2G takes tens of
 * seconds, and an indeterminate spinner there is indistinguishable from a hang — a supplier who
 * cannot tell will give up or upload everything twice.
 */
export function uploadListingPhotos(
  files: File[],
  onProgress: (progress: UploadProgress) => void,
): Promise<string[]> {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
  const url = `${base ? `${base}/api` : '/api'}/marketplace/listings/photos`;

  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files.slice(0, MAX_LISTING_PHOTOS)) {
      form.append('photos', file, file.name || 'photo.jpg');
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    const token = getAccessToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      onProgress({ ratio: event.lengthComputable ? event.loaded / event.total : null });
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // Left null — handled below as an unparseable response.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((payload as ListingPhotoUploadResult).urls);
        return;
      }

      // Same error shape the rest of the app throws, so one renderer covers both.
      const error = payload as { error?: { code?: string; message?: string } } | null;
      reject(
        new UploadError(
          xhr.status,
          error?.error?.code ?? 'internal_error',
          error?.error?.message ?? `upload failed with ${xhr.status}`,
        ),
      );
    };

    xhr.onerror = () => reject(new UploadError(0, 'network_error', 'the upload did not reach us'));
    xhr.onabort = () => reject(new UploadError(0, 'network_error', 'the upload was cancelled'));

    xhr.send(form);
  });
}
