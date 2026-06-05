# Vercel 배포 가이드

## 결론

현재 앱은 로컬 개인 사용에 맞춘 메모리 세션 구조입니다. 공개 Vercel 배포에는 그대로 쓰면 안 됩니다. Vercel 프로덕션 환경에서는 기본적으로 `/api/*` 요청을 503으로 차단하며, 보호된 개인 배포로 위험을 이해한 경우에만 `ALLOW_VERCEL_MEMORY_SESSION=true`를 설정해 API를 열 수 있습니다.

## 현재 Vercel 구성

- 프론트엔드: Vite 빌드 결과를 `dist/client`에 생성합니다.
- API: `api/index.ts`가 Express API 앱을 Vercel Function으로 내보냅니다.
- 라우팅: `vercel.json`에서 `/api/(.*)`를 `/api/index`로 보내고, 나머지는 SPA `index.html`로 보냅니다.
- 보안 헤더: `vercel.json`과 Express API 응답에 기본 보안 헤더를 설정합니다.

참고한 Vercel 공식 문서:

- Express on Vercel: https://vercel.com/docs/frameworks/backend/express
- Node.js Functions: https://vercel.com/docs/functions/runtimes/node-js
- Function limits: https://vercel.com/docs/functions/limitations
- Environment variables: https://vercel.com/docs/environment-variables

## 왜 기본 차단하는가

현재 서버는 로그인 후 받은 도서관 access token을 모듈 전역 메모리에 보관합니다. 로컬에서 한 명이 쓰면 단순하지만, Vercel의 실행 인스턴스는 요청 사이에 재사용될 수 있습니다. 공개 URL에 여러 사람이 접근하면 마지막 로그인 사용자의 세션을 다른 요청이 사용할 위험이 있습니다.

또한 Vercel은 함수 인스턴스를 여러 개 띄우거나 재시작할 수 있으므로, 메모리 세션은 인스턴스마다 다르고 언제든 사라질 수 있습니다. 이 문제는 보안 문제이면서 운영 안정성 문제입니다.

## 개인 보호 배포 절차

1. GitHub 저장소를 private으로 둡니다.
2. `.env`, `.vercel`, HAR 파일, DevTools 캡처, 토큰 문자열, 비밀번호가 커밋되지 않았는지 확인합니다.
3. Vercel에서 저장소를 import합니다.
4. Vercel 프로젝트에 Deployment Protection 또는 접근 제한을 켭니다.
5. 보호된 개인 사용만 할 것인지 다시 확인합니다.
6. 위험을 수용할 때만 환경 변수 `ALLOW_VERCEL_MEMORY_SESSION=true`를 설정합니다.
7. 배포 후 `/api/session`이 정상 응답하는지 확인합니다.
8. 실제 예약/취소 버튼은 의도한 동작일 때만 테스트합니다.

## 공개 또는 다중 사용자 배포에 필요한 재설계

공개 배포를 하려면 아래 구조로 바꿔야 합니다.

- 브라우저별 세션 식별자 발급
- `httpOnly`, `Secure`, `SameSite=Lax` 또는 `Strict` 쿠키 사용
- access token을 Vercel KV, Redis, 데이터베이스 같은 서버 측 저장소에 암호화해 저장
- 세션 TTL과 로그아웃 시 서버 측 토큰 삭제
- 예약/취소 같은 mutation 요청에 CSRF 방어 추가
- 로그인 rate limit을 메모리가 아닌 durable store 기준으로 적용
- 사용자별 조회 캐시 분리
- 토큰 만료와 refresh token 처리 정책 추가
- 실패한 예약/취소와 도서관 API 오류에 대한 운영 로그 추가

## Vercel에서 예상되는 운영 이슈

- 함수 인스턴스가 재시작되면 다시 로그인해야 합니다.
- 함수 인스턴스가 여러 개면 어떤 인스턴스에는 로그인 상태가 없을 수 있습니다.
- 한 날짜에 많은 호실을 조회하면 도서관 API 요청이 여러 개 나갑니다. 현재 앱은 동시 요청 3개와 60초 캐시로 부하를 줄입니다.
- 도서관 API가 변경되면 정적 호실 목록이나 응답 파싱이 깨질 수 있습니다.
- Vercel 환경 변수는 프로젝트 권한이 있는 사람에게 노출될 수 있으므로 비밀번호를 환경 변수에 넣지 마세요.

## 배포 전 검증

```sh
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
```

배포 후에는 다음만 먼저 확인하세요.

- `/api/session`이 의도한 상태를 반환하는가
- 로그인 후 날짜 조회가 되는가
- 내 예약 목록이 조회되는가
- 새로고침 또는 재배포 후 다시 로그인이 필요한 동작이 이해한 대로인가
