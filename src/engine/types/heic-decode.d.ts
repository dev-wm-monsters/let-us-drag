// Types for heic-decode 2.1.0 (the package ships none). Verified against node_modules/heic-decode/lib.js:
// `decode({ buffer })` resolves to { width, height, data } where data is RGBA (width*height*4).
declare module 'heic-decode' {
  interface DecodedImage {
    width: number
    height: number
    data: Uint8ClampedArray
  }
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>
  export = decode
}
