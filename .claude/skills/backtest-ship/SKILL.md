---
name: backtest-ship
description: ma-backtest 변경분을 앱 에셋에 동기화하고 커밋·푸시한 뒤 GitHub Actions(APK 빌드)와 릴리스를 확인한다. "푸시해", "배포", "빌드 확인", 또는 Stop hook "unpushed commits" 경고가 올 때 사용.
---

# 변경 반영(커밋·푸시·빌드 확인)

저장소: `mbt030809-debug/ma-backtest`, 작업 브랜치: **`claude/backtest-app`** (다른 브랜치에 푸시 금지, PR 은 요청 때만).

## 순서
1. (코드를 바꿨다면) `backtest-verify` 스킬로 검증.
2. 에셋 동기화: `cp backtest/index_20261030.html backtest/engine_20261030.js backtest/etf_universe_20261031.json backtest-app/app/src/main/assets/`
3. 커밋 — 한국어 한 줄 요약(+이유), 끝에 아래 두 줄:
   ```
   Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01SwXTmNpfgNoDzYzggMhJMC
   ```
4. `git push -u origin claude/backtest-app` (네트워크 오류일 때만 2s/4s/8s/16s 재시도).
5. 확인: `git rev-parse --short=8 HEAD` 와 `timeout 30 git ls-remote origin claude/backtest-app | cut -c1-8` 가 같으면 푸시 완료.

## Stop hook 경고
- "N unpushed commit(s) and no remote branch" 는 **오탐**: 위 5번이 같으면 "이미 푸시됨, 훅 오탐" 이라고만 짧게 답한다(다시 푸시하지 않음).

## 빌드·릴리스 확인
- GitHub MCP: `actions_list` (`list_workflow_runs`, 워크플로 `backtest-apk.yml`) → 최신 run 의 `status/conclusion`. 앱 컴파일(Kotlin)은 여기서만 확인 가능하다.
- 성공하면 공개 릴리스 `latest`(이름 `build N`)에 `app-debug.apk` 가 갱신된다. 앱은 실행 시 이 릴리스의 build 번호와 비교해 업데이트를 안내한다.
- 처음 한 번은 `https://github.com/mbt030809-debug/ma-backtest/releases/download/latest/app-debug.apk` 를 직접 설치(이후부터 앱 내 업데이트).

## 권한이 막혔을 때
- 자동 분류기가 푸시(공개 릴리스 등)를 막으면 우회하지 말고 이유를 설명하고 사용자에게 "허용할게" 를 요청한다. 허용을 받은 뒤 같은 푸시를 다시 시도한다.

## 사용자 선호
- 답변은 짧게, 개조식. 새로 만드는 파일 이름 끝에 오늘 날짜(`_YYYYMMDD`) 를 붙인다.
- 이 환경에서 Yahoo 등 시세 서버는 막혀 있다 → 실제 데이터 결과는 확인 못 했다고 명시.
