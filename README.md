# GIST Library Reservation Assistant

GIST 도서관 시설 예약 현황을 여러 호실 기준으로 한 번에 보고, 사용자가 확인한 1시간 단위 예약과 취소만 실행하는 개인용 웹 앱입니다.

## 빠른 실행

```sh
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

## 문서

- [사용법](./USAGE.md)

## 중요한 배포 주의사항

현재 앱은 비밀번호와 토큰을 파일이나 브라우저 저장소에 저장하지 않고, 실행 중인 Node/Vercel 함수 메모리에만 보관합니다. 이 구조는 로컬 개인 사용에는 단순하고 안전하지만, 공개 Vercel URL에서는 여러 방문자가 같은 서버 메모리를 공유할 수 있어 위험합니다.

그래서 Vercel 프로덕션 환경에서는 기본적으로 API가 차단됩니다. 보호된 개인 배포로 위험을 이해하고 진행할 때만 `ALLOW_VERCEL_MEMORY_SESSION=true`를 설정하세요. 공개 또는 다중 사용자 배포는 `httpOnly Secure` 쿠키와 서버 측 세션 저장소로 다시 설계해야 합니다.

## 검증

```sh
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
```
