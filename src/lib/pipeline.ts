// 사진 한 장 → 원(푸리에 계수)까지 전체 처리

import { addMaskOutline, blur, dilate, inkLines, isPhoto, outlineBlobs, removeSpecks, thin, toGray } from './edges';
import { dft, type Coef } from './fourier';
import { buildTour, resample, smoothChain, traceChains, type Pt } from './path';

export const WORK_SIZE = 640; // 선 따기 작업 크기(긴 변). 작은 사진도 이 크기로 키워서 세부 선을 살린다
const PAD = 16; // 가장자리에 닿은 선이 잘리지 않게 두는 흰 여백
export const PATH_POINTS = 4096; // 경로 점 개수(되돌아오는 길까지 포함)

export interface Processed {
  coefs: Coef[];
  srcW: number;
  srcH: number;
  edgeCount: number;
  chainCount: number;
  edgePreview: ImageData; // 뽑힌 선 확인용
}

/** 여백을 흰색 대신 가장자리 픽셀로 채운다. 사진이 잘려 끝나는 테두리가 가짜 선으로 잡히지 않게 한다. */
function padReplicate(d: Uint8ClampedArray, w: number, h: number) {
  const cl = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= PAD && x < w - PAD && y >= PAD && y < h - PAD) continue;
      const sx = cl(x, PAD, w - PAD - 1), sy = cl(y, PAD, h - PAD - 1);
      const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
      d[di] = d[si]; d[di + 1] = d[si + 1]; d[di + 2] = d[si + 2]; d[di + 3] = d[si + 3];
    }
}

/** 사진을 작업 크기로 맞추고(작으면 키움) 흰 여백을 두어 픽셀을 꺼낸다. */
export function rasterize(img: CanvasImageSource, iw: number, ih: number, maxSide = WORK_SIZE) {
  const k = (maxSide - PAD * 2) / Math.max(iw, ih);
  const dw = Math.max(1, Math.round(iw * k));
  const dh = Math.max(1, Math.round(ih * k));
  const w = dw + PAD * 2;
  const h = dh + PAD * 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, PAD, PAD, dw, dh);
  const data = ctx.getImageData(0, 0, w, h).data;
  padReplicate(data, w, h);
  return { w, h, data };
}

/** 배경 제거 결과(투명 PNG)를 같은 크기·여백으로 맞춰 마스크(대상=255)로 만든다. */
export function rasterizeMask(fg: CanvasImageSource, iw: number, ih: number, maxSide = WORK_SIZE): Uint8Array {
  const k = (maxSide - PAD * 2) / Math.max(iw, ih);
  const dw = Math.max(1, Math.round(iw * k));
  const dh = Math.max(1, Math.round(ih * k));
  const w = dw + PAD * 2;
  const h = dh + PAD * 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(fg, PAD, PAD, dw, dh);
  const d = ctx.getImageData(0, 0, w, h).data;
  padReplicate(d, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3];
  return keepMainObjects(mask, w, h);
}

/** 마스크에서 주 대상만 남긴다(가장 큰 덩어리의 30% 이상인 덩어리만). 배경에 남은 작은 조각을 지운다. */
function keepMainObjects(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i] < 128 || label[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && mask[j - 1] >= 128 && label[j - 1] < 0) { label[j - 1] = id; stack.push(j - 1); }
      if (x < w - 1 && mask[j + 1] >= 128 && label[j + 1] < 0) { label[j + 1] = id; stack.push(j + 1); }
      if (y > 0 && mask[j - w] >= 128 && label[j - w] < 0) { label[j - w] = id; stack.push(j - w); }
      if (y < h - 1 && mask[j + w] >= 128 && label[j + w] < 0) { label[j + w] = id; stack.push(j + w); }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (label[i] >= 0 && sizes[label[i]] >= big * 0.3) out[i] = 255;
  return out;
}

/** mask: 대상=255, 배경=0 (작업 크기와 같은 크기). 없으면 사진 전체를 쓴다. */
export function processImage(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  mask?: Uint8Array,
): Processed {
  const gray = toGray(rgba, w, h, mask);
  // 주변보다 어두운 잉크 선을 찾고(두꺼운 선도 한 덩어리), 대상 윤곽선을 더한다
  const R = Math.round(Math.max(w, h) / 40);
  const { photo, flat } = isPhoto(gray, mask);
  console.debug('[ink] flat=', flat.toFixed(2), 'photo=', photo);
  // 실사 사진: 털·결 같은 잔무늬를 흐리게 한 뒤 굵직한 선(눈·코·입·윤곽)만 남긴다
  const ink = photo
    ? outlineBlobs(removeSpecks(inkLines({ w, h, data: blur(gray) }, R, 'photo', mask), w, h, Math.round(Math.max(w, h) / 16)), w, h)
    : inkLines(gray, R, 'line', mask);
  if (mask) addMaskOutline(ink, mask, w, h);
  // 살짝 붙여 끊긴 곳을 메우고, 작은 얼룩을 지운 뒤, 가운데 한 줄로 가늘게
  const merged = removeSpecks(dilate(ink, w, h, 1), w, h, Math.round(Math.max(w, h) / (photo ? 16 : 32)));
  const edges = thin(merged, w, h);

  let edgeCount = 0;
  for (let i = 0; i < edges.length; i++) edgeCount += edges[i];

  const minLen = Math.max(6, Math.round(Math.max(w, h) / 80));
  const chains = traceChains(edges, w, h, minLen);
  if (!chains.length) throw new Error('선을 찾지 못했어요. 배경 지우기를 끄거나 다른 사진을 써 보세요.');

  const tour = buildTour(chains.map((c) => smoothChain(c)));
  const pts = resample(tour, PATH_POINTS);
  // 가운데를 (0,0)으로 옮긴다
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const centered: Pt[] = pts.map(([x, y]) => [x - cx, y - cy]);

  const preview = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = edges[i] ? 30 : 255;
    preview.data[i * 4] = preview.data[i * 4 + 1] = preview.data[i * 4 + 2] = v;
    preview.data[i * 4 + 3] = 255;
  }

  return {
    coefs: dft(centered),
    srcW: maxX - minX || w,
    srcH: maxY - minY || h,
    edgeCount,
    chainCount: chains.length,
    edgePreview: preview,
  };
}
