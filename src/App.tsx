import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { curve } from './lib/fourier';
import { makeGif } from './lib/gif';
import { PATH_POINTS, processImage, rasterize, rasterizeMask, type Processed } from './lib/pipeline';
import { TOTAL_SEC, drawFrame, type Scene } from './lib/render';
import './index.css';

const N_MIN = 5;
const N_MAX = 2000;
const N_DEFAULT = 100;
const MAX_BYTES = 10 * 1024 * 1024;

type Stage = 'idle' | 'working' | 'ready' | 'error';

function stamp() {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string>('');
  const [removeBg, setRemoveBg] = useState(true);
  const [n, setN] = useState(N_DEFAULT);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('사진을 올려 주세요.');
  const [ratio, setRatio] = useState(0);
  const [result, setResult] = useState<Processed | null>(null);
  const [showEdges, setShowEdges] = useState(false);
  const [gifRatio, setGifRatio] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fgCache = useRef<{ file: File; fg: ImageBitmap } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  // 사진 선택
  const pickFile = useCallback((f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      setStage('error');
      setMessage('JPG, PNG, WEBP 사진만 올릴 수 있어요.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setStage('error');
      setMessage('10MB 이하 사진만 올릴 수 있어요.');
      return;
    }
    setFile(f);
  }, []);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 사진이나 배경 지우기 설정이 바뀌면 처음부터 처리
  useEffect(() => {
    if (!file) return;
    const id = ++runId.current;
    (async () => {
      try {
        setStage('working');
        setResult(null);
        setRatio(0);
        setMessage('사진 읽는 중');
        const bmp = await createImageBitmap(file);
        const { w, h, data } = rasterize(bmp, bmp.width, bmp.height);
        let mask: Uint8Array | undefined;
        if (removeBg) {
          let fgBmp: ImageBitmap;
          if (fgCache.current?.file === file) {
            fgBmp = fgCache.current.fg;
          } else {
            const { removeBg } = await import('./lib/bg');
            fgBmp = await removeBg(file, (label, r) => {
              if (id !== runId.current) return;
              setMessage(label);
              setRatio(r);
            });
            fgCache.current = { file, fg: fgBmp };
          }
          mask = rasterizeMask(fgBmp, bmp.width, bmp.height);
          let fg = 0;
          for (let i = 0; i < mask.length; i++) if (mask[i] >= 128) fg++;
          if (fg < mask.length * 0.01) {
            mask = undefined; // 대상을 못 찾으면 전체 사진 사용
          }
        }
        if (id !== runId.current) return;
        setMessage('선 따는 중');
        await new Promise((r) => setTimeout(r, 30));
        const res = processImage(data, w, h, mask);
        if (id !== runId.current) return;
        setResult(res);
        setStage('ready');
        setMessage(`준비 완료 · 선 조각 ${res.chainCount}개를 한붓그리기로 이었어요`);
      } catch (e) {
        if (id !== runId.current) return;
        console.error(e);
        setStage('error');
        setMessage(e instanceof Error ? `처리 실패: ${e.message}` : '처리에 실패했어요.');
      }
    })();
  }, [file, removeBg]);

  const scene: Scene | null = useMemo(() => {
    if (!result) return null;
    const nn = Math.min(n, result.coefs.length);
    return { coefs: result.coefs, n: nn, curvePts: curve(result.coefs, nn, PATH_POINTS), srcW: result.srcW, srcH: result.srcH };
  }, [result, n]);

  // 미리보기 애니메이션(GIF와 같은 5초 반복)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !scene) return;
    const W = 600;
    const H = Math.min(Math.max(Math.round((W * scene.srcH) / scene.srcW), 300), 900);
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 1000) % TOTAL_SEC;
      drawFrame(ctx, W, H, scene, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  // 뽑힌 선 보기
  useEffect(() => {
    const cv = edgeCanvasRef.current;
    if (!cv || !result || !showEdges) return;
    cv.width = result.edgePreview.width;
    cv.height = result.edgePreview.height;
    cv.getContext('2d')!.putImageData(result.edgePreview, 0, 0);
  }, [result, showEdges]);

  const downloadGif = async () => {
    if (!scene) return;
    setGifRatio(0);
    try {
      const blob = await makeGif(scene, setGifRatio);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `TonTonjung_n${scene.n}_${stamp()}.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      setGifRatio(null);
    }
  };

  const setNSafe = (v: number) => {
    if (Number.isNaN(v)) return;
    setN(Math.max(N_MIN, Math.min(N_MAX, Math.round(v))));
  };

  return (
    <div className="app">
      <header>
        <h1>TonTonjung</h1>
        <p>사진을 올리면 원 여러 개가 돌면서 그림을 따라 그려요.</p>
      </header>

      <section className="card">
        <h2>① 사진 올리기</h2>
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files[0]);
          }}
        >
          {file ? <span>📷 {file.name} · 다른 사진으로 바꾸려면 클릭</span> : <span>여기에 사진을 끌어다 놓거나 클릭하세요 (JPG·PNG·WEBP, 10MB 이하)</span>}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            data-testid="file"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
          <span>배경 지우기 (인물·조형물만 선 따기)</span>
        </label>
        <div className={`status ${stage}`} data-testid="status">
          {message}
          {stage === 'working' && ratio > 0 && ratio < 1 && ` ${Math.round(ratio * 100)}%`}
        </div>
      </section>

      <section className="card">
        <h2>② 원본과 결과</h2>
        <div className="compare">
          <figure>
            <figcaption>
              원본
              {result && (
                <label className="mini">
                  <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} /> 뽑힌 선 보기
                </label>
              )}
            </figcaption>
            <div className="frame">
              {showEdges && result ? <canvas ref={edgeCanvasRef} /> : imgUrl ? <img src={imgUrl} alt="원본" /> : <div className="empty">사진 없음</div>}
            </div>
          </figure>
          <figure>
            <figcaption>결과 (원 {scene?.n ?? n}개)</figcaption>
            <div className="frame">
              {scene ? <canvas ref={canvasRef} data-testid="result" /> : <div className="empty">{stage === 'working' ? '만드는 중…' : '결과 없음'}</div>}
            </div>
          </figure>
        </div>

        <div className="slider">
          <label htmlFor="n">원 개수 n</label>
          <input id="n" type="range" min={N_MIN} max={N_MAX} value={n} onChange={(e) => setNSafe(+e.target.value)} />
          <input type="number" min={N_MIN} max={N_MAX} value={n} data-testid="n" onChange={(e) => setNSafe(+e.target.value)} />
        </div>
        <p className="hint">원이 적으면 둥글고 단순하게, 많으면 원본에 가깝게 그려져요. 원 개수와 상관없이 4초 안에 끝까지 그리고, 마지막 1초는 완성 그림에서 멈춰요.</p>
      </section>

      <section className="card">
        <h2>③ 내보내기</h2>
        <button className="primary" disabled={!scene || gifRatio !== null} onClick={downloadGif} data-testid="gif">
          {gifRatio === null ? 'GIF 다운로드 (약 5초)' : `GIF 만드는 중… ${Math.round(gifRatio * 100)}%`}
        </button>
        <p className="hint">4초 동안 그리고, 마지막 1초는 완성된 그림에서 멈춰요. 사진은 내 브라우저 안에서만 처리되고 어디에도 저장되지 않아요.</p>
      </section>
    </div>
  );
}
