declare module 'gifenc' {
  type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: object): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
  export function GIFEncoder(opts?: object): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
