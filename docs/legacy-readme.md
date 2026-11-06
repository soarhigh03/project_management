# TaskTrack

가벼운 **버그 추적 + 기능 구현 관리** 보드입니다. 프로젝트별로 분리되며, 설정(프로젝트·비밀번호·팀원·앱 영역)은 로컬 파일 하나로 관리합니다.

- 🐞 **버그** — 번호 자동 부여, 영역/긴급도/상태/담당자/마감일, 필터 검색(내 것만·미해결만 등)
- 🧩 **기능** — 언리얼 블루프린트 스타일 노드 그래프. 작업(잡) 노드 안에 할 일(태스크) 체크리스트, 노드끼리 연결해서 선행 의존성 표현 (순환 연결은 자동 차단)
- **의존성 0개** — npm install 필요 없음. Vercel 정적 파일 + 서버리스 함수만으로 동작

## 폴더 구조

```
config/projects.js   ← ★ 유일한 설정 파일 (프로젝트/비밀번호 해시/팀원/영역)
api/                 ← Vercel 서버리스 함수 (auth, bugs, features, config)
lib/                 ← 공용 로직 (인증, 저장소 어댑터, 도메인 로직)
public/              ← 정적 프론트엔드 (바닐라 JS)
scripts/             ← 개발 서버 + 비밀번호 해시 생성기
data/                ← 로컬 개발용 데이터 (gitignore됨)
```

## 1. 로컬에서 실행

Node 20 이상만 있으면 됩니다.

```bash
npm run dev
# → http://localhost:3000  (데모 프로젝트 비밀번호: demo1234)
```

로컬에서는 데이터가 `data/kv.json` 파일에 저장됩니다.

## 2. 프로젝트 관리 (config/projects.js)

```js
export default [
  {
    id: 'my-app',                  // URL에 들어감: /p/my-app/...
    name: '내 앱',
    passwordHash: 'scrypt:...',    // ↓ 해시 생성 방법 참고
    members: ['미잘', '은우'],      // 담당자 목록
    regions: ['홈', '검색', '설정'], // 버그 신고 시 영역 드롭다운
    // listed: false,              // 홈 화면 목록에서 숨기기
  },
];
```

**비밀번호 해시 생성:**

```bash
npm run hash -- "새비밀번호"
# 출력된 scrypt:... 를 passwordHash에 붙여넣기
```

파일을 수정한 뒤 다시 배포(`git push` 또는 `vercel`)하면 반영됩니다.

## 3. Vercel 배포

1. 이 폴더를 GitHub **private 저장소**에 push (또는 `vercel` CLI 사용)
2. [vercel.com](https://vercel.com) → **Add New Project** → 저장소 선택 → Framework는 **Other** 그대로 → Deploy
3. **저장소(DB) 연결** — 프로젝트 대시보드 → **Storage** 탭 → **Create Database** → Marketplace에서 **Upstash (Redis)** 선택 → 무료 플랜으로 생성 → 프로젝트에 연결
   - 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경 변수가 자동으로 들어갑니다 (Upstash 직접 연동 시 `UPSTASH_REDIS_REST_URL/TOKEN`도 인식)
4. **세션 시크릿 설정** — 프로젝트 → Settings → Environment Variables:
   - `AUTH_SECRET` = 긴 랜덤 문자열 (터미널에서 `openssl rand -base64 32` 로 생성)
5. Redeploy 한 번 하면 완료

## 4. 보안 참고사항

- **비밀번호는 scrypt 해시로만 저장** — `config/projects.js`가 유출돼도 원문 복원은 매우 어렵습니다. 그래도 저장소는 **private**을 권장합니다.
- **원문 비밀번호를 config에 절대 쓰지 마세요.** 반드시 `npm run hash`로 생성한 해시만 넣으세요.
- 세션은 `AUTH_SECRET`으로 서명한 HttpOnly 쿠키입니다. `AUTH_SECRET`이 바뀌면 전원 로그아웃됩니다.
- 로그인은 IP당 10분에 10회로 제한됩니다(서버리스 특성상 인스턴스별 최선 노력).
- 상태 변경 요청은 Origin 검사(CSRF 완화)를 거칩니다. HTTPS는 Vercel이 자동 제공합니다.
- 팀원 이름·영역 목록은 로그인한 사람에게만 내려갑니다. 홈 화면에는 프로젝트 이름/ID만 노출되며, `listed: false`로 그것마저 숨길 수 있습니다.
- 이 도구는 "팀 내부용 가벼운 공유 비밀번호" 모델입니다. 외부 공개 서비스 수준의 계정 보안(개인별 계정, 2FA 등)이 필요하다면 별도 인증 도입이 필요합니다.

## 5. 사용법 요약

| 동작 | 방법 |
|---|---|
| 버그 신고 | 버그 탭 → `+ 버그 신고` |
| 상태/담당자 빠른 변경 | 목록에서 드롭다운 바로 변경 |
| 버그 상세 수정/삭제 | 행 클릭 → 모달 |
| 필터 | `내 것만` / `미해결만` 칩, 영역·긴급도·상태 드롭다운, 검색창 |
| 작업(잡) 추가 | 기능 탭 → `+ 작업 추가` 또는 빈 곳 더블클릭 |
| 할 일(태스크) 추가 | 노드 하단 입력창에 쓰고 Enter |
| 의존성 연결 | 오른쪽 점(출력)을 드래그해 다른 노드에 놓기 |
| 연결 삭제 | 선 클릭 → 가운데 ✕ |
| 이름 변경 | 노드 제목/할 일 더블클릭 |
| 화면 이동/확대 | 빈 곳 드래그 / 마우스 휠 |

작업 노드는 할 일이 모두 체크되면 **완료**(초록), 선행 작업이 안 끝났으면 **선행 대기**(빨강)로 표시됩니다.
