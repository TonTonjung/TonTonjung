# TonTonjung

사진을 올리면 인물·조형물만 자동으로 선을 따서, 원(푸리에 급수) 여러 개가 그 선을 따라 그리는 애니메이션을 만들고 약 5초짜리 GIF(4초 그리기 + 1초 완성 정지)로 내려받는 개인용 웹 도구.

- 모든 처리는 **브라우저 안에서** 끝난다. 사진은 서버로 전송되지 않는다.
- 배경 제거 AI 모델 파일은 `public/bg/` 에 함께 배포한다(외부 CDN 의존 없음).

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 배포용 빌드(dist/)
```

## 구조

| 파일 | 역할 |
|---|---|
| `src/lib/bg.ts` | 배경 제거(@imgly/background-removal, 브라우저 실행) |
| `src/lib/edges.ts` | 선 따기(Canny) + 두 줄 합치기(팽창·세선화) |
| `src/lib/path.ts` | 선 조각 추적 → 한 줄로 잇기 → 같은 간격 재샘플 |
| `src/lib/fourier.ts` | 이산 푸리에 변환(DFT), 원 n개로 곡선 복원 |
| `src/lib/render.ts` | 한 장면 그리기(미리보기와 GIF 공용) |
| `src/lib/gif.ts` | GIF 만들기(gifenc, 600px, 20fps, 100장) |

## 배포(Vercel)

GitHub 저장소를 Vercel에 연결 → Framework: Vite, Build: `npm run build`, Output: `dist`.

## 라이선스

배경 제거 라이브러리(@imgly/background-removal)가 AGPL-3.0이므로 이 프로젝트도 AGPL-3.0으로 공개한다.
