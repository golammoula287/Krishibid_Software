import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let configured = false;

function ensureConfigured(): boolean {
  const e = env();
  if (!e.CLOUDINARY_CLOUD_NAME || !e.CLOUDINARY_API_KEY || !e.CLOUDINARY_API_SECRET) {
    return false;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: e.CLOUDINARY_CLOUD_NAME,
      api_key: e.CLOUDINARY_API_KEY,
      api_secret: e.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return true;
}

/**
 * Uploads an image and returns its URL.
 *
 * Falls back to an inline data URL when Cloudinary isn't configured, so the whole
 * diagnosis flow still works end-to-end for a contributor who hasn't signed up for
 * a storage account. Not suitable for production — the image becomes ~100 KB of
 * base64 inside a Mongo document — hence the explicit warning.
 */
export async function uploadImage(buffer: Buffer, folder: string): Promise<string> {
  if (!ensureConfigured()) {
    logger.warn(
      'Cloudinary not configured — storing image inline as a data URL (development only)',
    );
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        format: 'jpg',
        // Server-side transform caps what we ever serve, protecting the free
        // bandwidth quota regardless of what the client uploaded.
        transformation: [{ width: 1024, height: 1024, crop: 'limit', quality: 'auto:good' }],
      },
      (error, result) => {
        if (error || !result) {
          reject(new Error(error?.message ?? 'cloudinary upload failed'));
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}
