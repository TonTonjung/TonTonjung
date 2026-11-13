// 한 장면(프레임) 그리기. 미리보기와 GIF가 같은 함수를 쓴다.

import type { Coef } from './fourier';
import type { Pt } from './path';

export const DRAW_SEC = 4; // 그리는 시간
export const HOLD_SEC = 1; // 완성 후 정지 시간
export const TOTAL_SEC = DRAW_SEC + HOLD_SEC;

export interface Scene {
  coefs: Coef[];
  n: number;
  curvePts: Pt[]; // curve(coefs, n)
  srcW: number; // 처리한 사진 크기(좌표계)
  srcH: number;
}

/**
 * time: 0~TOTAL_SEC. 처음 4초는 원이 돌며 그리고, 마지막 1초는 완성 그림만 보여준다.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: Scene, time: number) {
  const scale = Math.min(W / s.srcW, H / s.srcH) * 0.92;
  const ox = W / 2, oy = H / 2;
  const X = (p: number) => ox + p * scale;
  const Y = (p: number) => oy + p * scale;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const p = Math.min(1, time / DRAW_SEC);
  const drawing = time < DRAW_SEC;
  const m = s.curvePts.length - 1;
  const upto = drawing ? Math.floor(p * m) : m;

  // 지금까지 그려진 선
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = Math.max(3, W / 160); // 그림 선 굵기
  ctx.beginPath();
  for (let i = 0; i <= upto; i++) {
    const [x, y] = s.curvePts[i];
    if (i === 0) ctx.moveTo(X(x), Y(y));
    else ctx.lineTo(X(x), Y(y));
  }
  ctx.stroke();

  if (!drawing) return;

  // 회전하는 원과 화살표
  let cx = 0, cy = 0;
  ctx.lineWidth = 1;
  for (let i = 0; i < s.n; i++) {
    const c = s.coefs[i];
    const a = 2 * Math.PI * c.freq * p + c.phase;
    const nx = cx + c.amp * Math.cos(a);
    const ny = cy + c.amp * Math.sin(a);
    if (c.freq !== 0) {
      const r = c.amp * scale;
      if (r > 1) {
        ctx.strokeStyle = 'rgba(59,130,246,0.25)';
        ctx.beginPath();
        ctx.arc(X(cx), Y(cy), r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(37,99,235,0.7)';
      ctx.beginPath();
      ctx.moveTo(X(cx), Y(cy));
      ctx.lineTo(X(nx), Y(ny));
      ctx.stroke();
    }
    cx = nx;
    cy = ny;
  }
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(X(cx), Y(cy), Math.max(2.5, W / 200), 0, Math.PI * 2);
  ctx.fill();
}
