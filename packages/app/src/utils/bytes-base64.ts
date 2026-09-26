/**
 * Base64 for the file APIs of the platforms we run on.
 *
 * Chunked on purpose: `String.fromCharCode(...bytes)` over a whole file spreads one argument per byte
 * and blows the stack on anything past a few tens of kilobytes, which is well below the size of a file a
 * user would download.
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
