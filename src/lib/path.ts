// 선 픽셀들 → 하나로 이어진 닫힌 경로

export type Pt = [number, number];

const NB: Pt[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], // 상하좌우를 먼저
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];

/** 이어진 선 픽셀을 따라가며 선 조각(체인)들로 나눈다. */
export function traceChains(edges: Uint8Array, w: number, h: number, minLen = 8): Pt[][] {
  const seen = new Uint8Array(w * h);
  const chains: Pt[][] = [];
  const walk = (sx: number, sy: number): Pt[] => {
    const pts: Pt[] = [];
    let x = sx, y = sy;
    for (;;) {
      let moved = false;
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (edges[k] && !seen[k]) {
          seen[k] = 1;
          pts.push([nx, ny]);
          x = nx; y = ny;
          moved = true;
          break;
        }
      }
      if (!moved) return pts;
    }
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edges[i] || seen[i]) continue;
      seen[i] = 1;
      const fwd = walk(x, y);
      const back = walk(x, y); // 시작점의 반대쪽으로도 늘린다
      const chain: Pt[] = [...back.reverse(), [x, y], ...fwd];
      if (chain.length >= minLen) chains.push(chain);
    }
  return chains;
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** 선 조각을 부드럽게 편다(계단 모양·잔떨림 제거). 양 끝점은 그대로 둔다. */
export function smoothChain(c: Pt[], radius = 3, passes = 2): Pt[] {
  let cur = c;
  for (let p = 0; p < passes; p++) {
    const out: Pt[] = cur.map((pt) => [pt[0], pt[1]] as Pt);
    for (let i = 1; i < cur.length - 1; i++) {
      const r = Math.min(radius, i, cur.length - 1 - i);
      let sx = 0, sy = 0;
      for (let k = -r; k <= r; k++) {
        sx += cur[i + k][0];
        sy += cur[i + k][1];
      }
      out[i] = [sx / (2 * r + 1), sy / (2 * r + 1)];
    }
    cur = out;
  }
  return cur;
}

/**
 * 한붓그리기 경로 만들기.
 * 선 조각들을 가장 짧은 연결선으로 나무 모양으로 묶은 뒤(최소 신장 트리),
 * 각 조각을 따라갔다가 같은 길로 되돌아오는 순서로 한 번에 이어 그린다.
 * 되돌아오는 길은 이미 그린 선 위를 지나므로, 새로 보이는 선은 짧은 연결선뿐이다.
 */
export function buildTour(chains: Pt[][]): Pt[] {
  if (!chains.length) return [];
  const C = chains.length;
  // 가장 긴 조각을 뿌리로
  let root = 0;
  for (let i = 1; i < C; i++) if (chains[i].length > chains[root].length) root = i;

  const attached = new Uint8Array(C);
  // 붙지 않은 조각의 두 끝점마다: 가장 가까운 '이미 붙은 점'까지 거리와 그 위치
  const bestD = new Float64Array(C * 2).fill(Infinity);
  const bestAt: { chain: number; idx: number }[] = new Array(C * 2);
  const children: Map<number, { child: number; fromEnd: boolean }[]>[] = chains.map(() => new Map());

  const relax = (src: number) => {
    const pts = chains[src];
    for (let c = 0; c < C; c++) {
      if (attached[c]) continue;
      const ends = [chains[c][0], chains[c][chains[c].length - 1]];
      for (let e = 0; e < 2; e++) {
        const q = ends[e];
        let bd = bestD[c * 2 + e], bi = -1;
        for (let i = 0; i < pts.length; i++) {
          const d = d2(q, pts[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        if (bi >= 0) {
          bestD[c * 2 + e] = bd;
          bestAt[c * 2 + e] = { chain: src, idx: bi };
        }
      }
    }
  };

  attached[root] = 1;
  relax(root);
  for (let step = 1; step < C; step++) {
    let pick = -1, pd = Infinity;
    for (let k = 0; k < C * 2; k++) {
      if (attached[k >> 1]) continue;
      if (bestD[k] < pd) { pd = bestD[k]; pick = k; }
    }
    if (pick < 0) break;
    const c = pick >> 1;
    const { chain, idx } = bestAt[pick];
    const list = children[chain].get(idx) ?? [];
    list.push({ child: c, fromEnd: (pick & 1) === 1 });
    children[chain].set(idx, list);
    attached[c] = 1;
    relax(c);
  }

  // 깊이 우선으로 따라가며 경로 만들기(각 조각은 갔다가 되돌아온다)
  const out: Pt[] = [];
  const visit = (c: number, fromEnd: boolean) => {
    const pts = chains[c];
    const L = pts.length;
    const order = (k: number) => (fromEnd ? L - 1 - k : k);
    for (let k = 0; k < L; k++) {
      const i = order(k);
      out.push(pts[i]);
      const kids = children[c].get(i);
      if (kids)
        for (const kd of kids) {
          visit(kd.child, kd.fromEnd);
          out.push(pts[i]); // 연결선을 따라 원래 자리로 돌아옴
        }
    }
    for (let k = L - 2; k >= 0; k--) out.push(pts[order(k)]); // 같은 길로 되돌아가기
  };
  visit(root, false);
  return out;
}

/** 경로를 같은 간격의 점 n개로 다시 뽑는다(닫힌 경로 기준). */
export function resample(pts: Pt[], n: number): Pt[] {
  if (pts.length < 2) return pts;
  const closed = [...pts, pts[0]];
  const cum = [0];
  for (let i = 1; i < closed.length; i++)
    cum.push(cum[i - 1] + Math.sqrt(d2(closed[i], closed[i - 1])));
  const total = cum[cum.length - 1];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * total;
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = (t - cum[j]) / seg;
    out.push([
      closed[j][0] + (closed[j + 1][0] - closed[j][0]) * f,
      closed[j][1] + (closed[j + 1][1] - closed[j][1]) * f,
    ]);
  }
  return out;
}
