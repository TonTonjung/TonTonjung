// 사진 → 선(엣지) 추출. 외부 라이브러리 없이 Canny 방식을 직접 구현한다.

export interface Gray {
  w: number;
  h: number;
  data: Float32Array; // 0~255 밝기
}

/** RGBA 픽셀을 흑백으로 바꾼다. mask가 있으면 대상 밖(배경)은 흰색으로 지운다. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number, mask?: Uint8Array): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255; // 투명 PNG는 흰 바탕 위에 올린 것으로 본다
    const r = rgba[i * 4] * a + 255 * (1 - a);
    const g = rgba[i * 4 + 1] * a + 255 * (1 - a);
    const b = rgba[i * 4 + 2] * a + 255 * (1 - a);
    let v = 0.299 * r + 0.587 * g + 0.114 * b;
    if (mask && mask[i] < 128) v = 255;
    data[i] = v;
  }
  return { w, h, data };
}

export function blur(src: Gray): Float32Array {
  // 5x5 가우시안(sigma≈1.4)을 가로·세로로 나눠 적용
  const k = [2, 4, 5, 4, 2];
  const ks = 17;
  const { w, h, data } = src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += data[y * w + xx] * k[i + 2];
      }
      tmp[y * w + x] = s / ks;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x] * k[i + 2];
      }
      out[y * w + x] = s / ks;
    }
  return out;
}

/** Canny 엣지 검출. 결과는 선=1, 나머지=0 */
export function canny(src: Gray): Uint8Array {
  const { w, h } = src;
  const b = blur(src);
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h); // 0:가로 1:대각/ 2:세로 3:대각\
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
      const gy =
        -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  // 가장 강한 지점만 남기기(선 굵기 1픽셀로)
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      let a = 0,
        c = 0;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; c = mag[i + 1]; break;
        case 1: a = mag[i - w + 1]; c = mag[i + w - 1]; break;
        case 2: a = mag[i - w]; c = mag[i + w]; break;
        default: a = mag[i - w - 1]; c = mag[i + w + 1];
      }
      if (m >= a && m >= c) nms[i] = m;
    }
  // 이중 기준값 + 이어 붙이기
  const high = maxMag * 0.2;
  const low = high * 0.4;
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (nms[i] >= high && !out[i]) {
      out[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % w, jy = (j / w) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx, ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const k = ny * w + nx;
            if (!out[k] && nms[k] >= low) {
              out[k] = 1;
              stack.push(k);
            }
          }
      }
    }
  return out;
}

/** 마스크(대상 영역)의 바깥 윤곽선 픽셀을 선에 더한다. */
export function addMaskOutline(edges: Uint8Array, mask: Uint8Array, w: number, h: number) {
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] < 128) continue;
      if (mask[i - 1] < 128 || mask[i + 1] < 128 || mask[i - w] < 128 || mask[i + w] < 128) edges[i] = 1;
    }
}

/** 선을 radius만큼 두껍게 한다(가까운 두 줄을 하나로 합치기 위해). */
export function dilate(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + 1) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
    }
  return out;
}

/** Zhang-Suen 세선화: 두꺼운 선을 가운데 1픽셀 선으로 만든다. */
export function thin(img: Uint8Array, w: number, h: number): Uint8Array {
  const a = img.slice();
  let changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!a[i]) continue;
          const p2 = a[i - w], p3 = a[i - w + 1], p4 = a[i + 1], p5 = a[i + w + 1];
          const p6 = a[i + w], p7 = a[i + w - 1], p8 = a[i - 1], p9 = a[i - w - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
          if (A !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(i);
        }
      if (del.length) changed = true;
      for (const i of del) a[i] = 0;
    }
  }
  return a;
}

/**
 * 잉크 선 찾기(적응형 기준값): 주변보다 확실히 어두운 픽셀을 선으로 본다.
 * 선화는 선 자체가, 사진은 어두운 경계가 잡힌다. 두꺼운 선도 한 덩어리로 잡혀서
 * 세선화하면 가운데 한 줄만 남는다(양쪽 두 줄 문제 없음).
 */
export const K_PHOTO = 1.0;

/**
 * 실사 사진인지 판단: 선화·일러스트는 색이 고르게 칠해진 평평한 면이 많고,
 * 실사 사진은 털·결·노이즈 때문에 평평한 곳이 적다.
 */
export function isPhoto(src: Gray, mask?: Uint8Array): { photo: boolean; flat: number } {
  const { w, h, data } = src;
  let flat = 0, total = 0;
  for (let y = 0; y < h - 1; y += 2)
    for (let x = 0; x < w - 1; x += 2) {
      const i = y * w + x;
      if (mask && mask[i] < 128) continue;
      total++;
      if (Math.abs(data[i] - data[i + 1]) <= 2 && Math.abs(data[i] - data[i + w]) <= 2) flat++;
    }
  const r = total ? flat / total : 1;
  return { photo: r < 0.5, flat: r };
}

/** 주변보다 어두운 정도(diff)의 상위 10% 값 */
function p90Of(diff: Float32Array, mask?: Uint8Array) {
  const vals: number[] = [];
  for (let i = 0; i < diff.length; i += 3) if (!mask || mask[i] >= 128) vals.push(Math.abs(diff[i]));
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.9)] ?? 0;
}

/** c: 'line'=선화용 고정 기준, 'photo'=결이 많을수록 기준을 높임 */
export function inkLines(src: Gray, radius: number, mode: 'line' | 'photo', mask?: Uint8Array): Uint8Array {
  const { w, h, data } = src;
  // 적분 영상으로 주변 평균을 빠르게 계산
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
    }
  }
  const diff = new Float32Array(w * h); // 주변 평균보다 얼마나 어두운지
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
      const sum =
        integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      diff[y * w + x] = sum / ((x1 - x0) * (y1 - y0)) - data[y * w + x];
    }
  const c = mode === 'photo' ? Math.max(14, p90Of(diff, mask) * K_PHOTO) : 12;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (diff[i] > c) out[i] = 1;
  return out;
}

/** 크기가 minSize 픽셀보다 작은 점·얼룩을 지운다. */
export function removeSpecks(img: Uint8Array, w: number, h: number, minSize: number): Uint8Array {
  const out = img.slice();
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!out[i] || seen[i]) continue;
    comp.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const jx = j % w, jy = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (out[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
    }
    if (comp.length < minSize) for (const j of comp) out[j] = 0;
  }
  return out;
}

/** 덩어리의 테두리만 남긴다(눈·코처럼 꽉 찬 어두운 부분을 동그란 윤곽선으로). 얇은 선은 그대로 남는다. */
export function outlineBlobs(img: Uint8Array, w: number, h: number, depth = 2): Uint8Array {
  let inner = img;
  for (let d = 0; d < depth; d++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (inner[i] && inner[i - 1] && inner[i + 1] && inner[i - w] && inner[i + w]) next[i] = 1;
      }
    inner = next;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (img[i] && !inner[i]) out[i] = 1;
  return out;
}
