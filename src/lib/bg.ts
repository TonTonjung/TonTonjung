// 배경 제거: 브라우저 안에서 AI 모델로 대상(인물·조형물)만 남긴다.
// 모델 파일은 /public/bg 에 같이 배포한다(외부 서버 의존 없음).

import { removeBackground } from '@imgly/background-removal';

/** 배경이 지워진 사진(투명 PNG)을 돌려준다. */
export async function removeBg(
  file: Blob,
  onProgress?: (label: string, ratio: number) => void,
): Promise<ImageBitmap> {
  const blob = await removeBackground(file, {
    publicPath: new URL('/bg/', window.location.href).href,
    model: 'small',
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      const label = key.startsWith('fetch') ? 'AI 모델 내려받는 중(처음 한 번만)' : '배경 지우는 중';
      onProgress?.(label, total ? cur / total : 0);
    },
  });
  return createImageBitmap(blob);
}
