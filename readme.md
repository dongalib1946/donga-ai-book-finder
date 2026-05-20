# AI 도서 큐레이터

동아대학교 도서관 소장도서를 기반으로 질문형 책 추천을 제공하는 Netlify 사이트입니다.

## 실행

```powershell
$env:ALADIN_TTB_KEY="알라딘 TTB 키"
npm start
```

로컬 실행에는 별도 패키지 설치가 필요 없습니다. `ALADIN_TTB_KEY`가 없으면 도서관 목록 기반의 제한된 추천만 반환합니다.

## 배포 환경변수

알라딘 TTB 키 같은 민감한 값은 코드나 Git에 넣지 말고 Netlify 환경변수로 설정합니다.

- Netlify: `Site configuration` > `Environment variables`
- 변수명: `ALADIN_TTB_KEY`
- 로컬 예시: `.env.example`

## 구조

- `index.html`: 질문 UI와 결과 화면
- `app.js`: 프론트 상태 관리와 API 호출
- `netlify/data/questions.json`: 질문과 선택지 데이터
- `netlify/functions/questions.js`: 질문 데이터 API
- `netlify/functions/recommend-books.js`: 도서관 컬렉션 수집, 알라딘 ISBN 조회, 답변 기반 점수화
- `local-server.js`: 로컬 테스트용 정적 파일 및 함수 서버
