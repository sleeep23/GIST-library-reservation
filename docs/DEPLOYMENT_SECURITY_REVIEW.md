# 배포 보안 검토

이 문서는 GitHub/Vercel 배포 전 수행한 집중 점검 기록입니다. 전체 Codex Security 저장소 스캔은 별도 subagent 승인과 스캔 산출물이 필요한 절차이므로, 여기서는 현재 배포 경로와 실제 위험도가 높은 항목을 중심으로 검토했습니다.

## 주요 결과

| 심각도 | 항목 | 상태 |
| --- | --- | --- |
| Blocker | 공개 Vercel 배포에서 전역 메모리 세션이 사용자 간에 섞일 수 있음 | 기본 503 차단 추가. 공개 배포 전 세션 저장소 재설계 필요 |
| High | Vercel 함수 인스턴스 재시작/다중 인스턴스로 로그인 상태가 사라지거나 일관되지 않을 수 있음 | 문서화. 개인 보호 배포에서만 허용 가능 |
| Medium | 도서관 API 지연 시 요청이 오래 걸릴 수 있음 | 15초 타임아웃 추가 |
| Medium | 도서관 API fan-out으로 부하가 커질 수 있음 | 동시 요청 3개와 60초 캐시 유지 |
| Medium | 프로덕션 에러 응답에 upstream 상세가 노출될 수 있음 | 프로덕션에서는 `details` 제거 |
| Medium | 로그인 brute force 방어가 약함 | IP 기준 5분 8회 메모리 rate limit 추가. 공개 배포는 durable rate limit 필요 |
| Low | 알 수 없는 API 경로가 SPA HTML로 떨어질 수 있음 | `/api` 404 JSON 응답 추가 |
| Low | 정적 호실 목록과 예약 가능 기간 가정이 도서관 UI 변경에 취약함 | 알려진 운영 리스크로 문서화 |
| Low | 보안 헤더 부족 | API와 Vercel 정적 응답에 기본 보안 헤더 추가 |

## 민감정보 점검

현재 저장소 검색에서 실제 JWT, `Bearer` 토큰 값, 비밀번호, 사용자 ID 실값은 발견되지 않았습니다. 코드에 `userPwd`, `accessToken`, `Authorization` 문자열은 구현상 필요한 식별자로만 존재합니다.

추가로 `.gitignore`에 아래 항목을 포함했습니다.

- `.env`, `.env.*`
- `.vercel/`
- `*.har`
- `*.webarchive`

GitHub push 전에는 DevTools 네트워크 캡처, 스크린샷, 붙여넣은 API 응답 파일에 토큰이 들어가지 않았는지 한 번 더 확인해야 합니다.

## 배포 판단

로컬 개인 사용은 현재 구조로 충분합니다. Vercel 개인 배포는 접근 제한을 켜고 `ALLOW_VERCEL_MEMORY_SESSION=true`를 설정한 경우에만 제한적으로 허용할 수 있습니다.

공개 URL 또는 여러 사용자가 접근하는 배포는 현재 구조로 진행하면 안 됩니다. 그 경우 [Vercel 배포 가이드](./VERCEL_DEPLOYMENT.md)의 세션 재설계 항목을 먼저 구현해야 합니다.

## 검증 명령

배포 전 아래 명령을 모두 통과시켜야 합니다.

```sh
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
```

## 현재 검증 결과

2026-06-05 기준 아래 항목을 통과했습니다.

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm audit --audit-level=moderate`: `found 0 vulnerabilities`
