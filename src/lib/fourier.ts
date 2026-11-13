// 푸리에 급수: 경로 점들 → 회전하는 원(에피사이클) 목록

import type { Pt } from './path';

export interface Coef {
  freq: number; // 1초(한 바퀴)에 몇 번 도는지
  amp: number; // 원의 반지름
  phase: number; // 시작 각도
}

/** 이산 푸리에 변환(DFT). 크기가 큰 원부터 정렬해서 돌려준다(0번 주파수=중심은 맨 앞). */
export function dft(points: Pt[]): Coef[] {
  const N = points.length;
  const cosT = new Float64Array(N), sinT = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / N);
    sinT[i] = Math.sin((2 * Math.PI * i) / N);
  }
  const xs = Float64Array.from(points, (p) => p[0]);
  const ys = Float64Array.from(points, (p) => p[1]);
  const out: Coef[] = [];
  const half = Math.floor(N / 2);
  for (let k = -half; k < N - half; k++) {
    let re = 0, im = 0;
    const kk = ((k % N) + N) % N;
    let idx = 0;
    for (let j = 0; j < N; j++) {
      // e^{-iθ}, θ = 2π k j / N
      const c = cosT[idx], s = sinT[idx];
      re += xs[j] * c + ys[j] * s;
      im += ys[j] * c - xs[j] * s;
      idx += kk;
      if (idx >= N) idx -= N;
    }
    re /= N;
    im /= N;
    out.push({ freq: k, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
  }
  out.sort((a, b) => (a.freq === 0 ? -1 : b.freq === 0 ? 1 : b.amp - a.amp));
  return out;
}

/** 원 n개를 썼을 때 시각 t(0~1)의 끝점 위치 */
export function evalAt(coefs: Coef[], n: number, t: number): Pt {
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const c = coefs[i];
    const a = 2 * Math.PI * c.freq * t + c.phase;
    x += c.amp * Math.cos(a);
    y += c.amp * Math.sin(a);
  }
  return [x, y];
}

/** 원 n개로 그린 전체 곡선(점 m+1개) */
export function curve(coefs: Coef[], n: number, m = 4096): Pt[] {
  const cosT = new Float64Array(m), sinT = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / m);
    sinT[i] = Math.sin((2 * Math.PI * i) / m);
  }
  const xs = new Float64Array(m), ys = new Float64Array(m);
  for (let c = 0; c < n; c++) {
    const { freq, amp, phase } = coefs[c];
    const ac = amp * Math.cos(phase), as = amp * Math.sin(phase);
    const step = ((freq % m) + m) % m;
    let idx = 0;
    for (let i = 0; i < m; i++) {
      // amp·e^{i(2π f i/m + φ)}
      xs[i] += ac * cosT[idx] - as * sinT[idx];
      ys[i] += ac * sinT[idx] + as * cosT[idx];
      idx += step;
      if (idx >= m) idx -= m;
    }
  }
  const pts: Pt[] = [];
  for (let i = 0; i <= m; i++) pts.push([xs[i % m], ys[i % m]]);
  return pts;
}
