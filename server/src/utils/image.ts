/**
 * Checks on uploaded images that every upload route needs.
 *
 * This lived in `diagnosis.service.ts` and was imported by four controllers, three of which have
 * nothing to do with disease detection — so reading any of them suggested a dependency on the
 * ONNX model that was not there. It is a byte check; it belongs with the utilities.
 */

/**
 * Magic-byte check.
 *
 * The client-supplied Content-Type is trivially spoofable, so the declared MIME is
 * only a first filter. This inspects the actual leading bytes, which is what stops
 * a renamed script or a polyglot file from reaching `sharp`.
 */
export function sniffImage(buffer: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}
