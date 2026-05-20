# AI 도서 큐레이터

동아대학교 도서관 소장도서를 기반으로 질문형 책 추천을 제공하는 Netlify 사이트입니다.

## 실행

```powershell
npm install
$env:ALADIN_TTB_KEY="알라딘 TTB 키"
npm start
```

처음 실행할 때 의존성을 설치합니다. `ALADIN_TTB_KEY`가 없으면 도서관 목록 기반의 제한된 추천만 반환합니다.

## 배포 환경변수

알라딘 TTB 키 같은 민감한 값은 코드나 Git에 넣지 말고 Netlify 환경변수로 설정합니다.

- Netlify: `Site configuration` > `Environment variables`
- 변수명: `ALADIN_TTB_KEY`
- 로컬 예시: `.env.example`

## 구조

- `public/index.html`: 질문 UI와 결과 화면
- `public/app.js`: 프론트 상태 관리와 API 호출
- `public/img/`: 정적으로 공개되는 이미지
- `netlify/data/questions.json`: 질문과 선택지 데이터
- `netlify/functions/questions.js`: 질문 데이터 API
- `netlify/functions/recommend-books.js`: 도서관 컬렉션 수집, 알라딘 ISBN 조회, 답변 기반 점수화
- `local-server.js`: 로컬 테스트용 정적 파일 및 함수 서버

## 데이터 공개 범위

Netlify의 정적 공개 폴더는 `public/`입니다. `netlify/data/*.json`은 정적 파일로 배포하지 않고 Netlify Function 번들에만 포함해 API에서 읽습니다.
