// GIF 만들기: 4초 그리기 + 1초 완성 정지, 20fps

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { DRAW_SEC, TOTAL_SEC, drawFrame, type Scene } from './render';

export const GIF_WIDTH = 600;
export const FPS = 20;

export async function makeGif(scene: Scene, onProgress: (r: number) => void): Promise<Blob> {
  const W = GIF_WIDTH;
  const H = Math.round((W * scene.srcH) / scene.srcW / 2) * 2;
  const Hc = Math.min(Math.max(H, 300), 900);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hc;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;

  const frames = TOTAL_SEC * FPS; // 100장
  const delay = 1000 / FPS;

  // 원과 선 색이 모두 들어간 장면으로 색표를 하나 만들어 모든 장면에 쓴다
  drawFrame(ctx, W, Hc, scene, DRAW_SEC * 0.6);
  const palette = quantize(ctx.getImageData(0, 0, W, Hc).data, 64);

  const gif = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    // 마지막 그리기 장면이 정확히 완성(t=DRAW_SEC)에 닿도록
    const t = f < DRAW_SEC * FPS ? (f / (DRAW_SEC * FPS - 1)) * DRAW_SEC * 0.9999 : DRAW_SEC;
    drawFrame(ctx, W, Hc, scene, t);
    const data = ctx.getImageData(0, 0, W, Hc).data;
    const index = applyPalette(data, palette);
    gif.writeFrame(index, W, Hc, f === 0 ? { palette, delay, repeat: 0 } : { delay });
    if (f % 5 === 0) {
      onProgress(f / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  gif.finish();
  onProgress(1);
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
