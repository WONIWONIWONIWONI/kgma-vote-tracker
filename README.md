# KGMA TOP 3 — VOTE/TRACK

2026 KGMA Berriz 공개 투표 화면의 상위 3팀을 기록하고 시각화합니다.

## 현재 확인된 상태

- 현재 기록은 자동 수집으로 확인한 값만 포함하며 **2026-10-07 00:45 KST**부터 시작합니다. 사용자 캡처로 추가했던 기록은 삭제했습니다.
- **GitHub Actions에서 실제 공개 페이지 수집과 기록 저장을 확인했습니다.** 첫 성공은 2026-10-07 00:51 KST이며, 원본 집계 시각 00:45 KST의 RESCENE 3,506표, RIIZE 3,091표, SHOWNU X HYUNGWON 892표를 저장했습니다. 작업 환경과 달리 GitHub 실행 환경에서 원본에 정상 접속했습니다.
- 확인되지 않은 과거 데이터는 포함하지 않았습니다. 저장 데이터에는 관측값만 포함하고, 그래프에서는 미관측 구간의 앞뒤 관측점을 직선으로 연결합니다.

## 화면 열기

`dist/index.html`을 열면 저장된 기록을 바로 볼 수 있습니다. GitHub Pages에서는 공개 저장소의 최신 `dist/data/history.json`을 1분마다 직접 읽습니다. 연결 실패 시 배포 당시 사본과 이미 불러온 기록을 보존합니다. **페이지 새로고침과 데이터 수집은 별개입니다.** 현재 운영 중인 GitHub Actions가 방문자 유무와 관계없이 기록을 저장합니다. 매번 사이트를 다시 배포할 필요 없이 최신 기록이 반영됩니다. 사용자의 컴퓨터나 ChatGPT를 켜 둘 필요가 없습니다.

## 공개 운영 — GitHub Pages + Actions

1. 이 프로젝트를 새 공개 GitHub 저장소의 `main` 브랜치에 올립니다. `.github/workflows` 폴더도 포함합니다.
2. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 설정합니다.
3. Actions → **Collect KGMA votes continuously**와 **Publish KGMA dashboard**를 각각 한 번 실행합니다. 관련 코드 변경 시에는 자동 실행됩니다.
4. 수집 성공 로그의 `sourceAt`과 공식 페이지를 비교합니다. 수집 실패 시에도 마지막으로 검증된 기록과 오류 상태를 저장합니다. 과거 값을 0이나 가짜 값으로 바꾸지 않습니다.
5. 게시 작업에 표시되는 `https://사용자명.github.io/저장소명/` 주소를 공유합니다.

수집 작업 하나가 최대 **5시간 30분** 동안 실행되며, 시작 직후 한 번 수집한 다음 매 5분 경계에서 90초 뒤(예: 01:06:30, 01:11:30)에 확인합니다. 수집에 걸리는 시간을 다음 간격에 더하지 않아 주기가 계속 밀리지 않습니다. 각 회차는 원본 조회 후 검증된 기록과 상태를 즉시 커밋합니다.

예약식 `7,22,37,52 * * * *`는 다음 실행을 미리 대기시키는 용도입니다. 같은 동시 실행 그룹에서 수집기는 하나만 실행되고, 새 예약은 대기 중인 작업만 교체합니다. 현재 작업이 끝나면 대기 작업이 최신 `main`을 받아 이어받습니다. 한 번 실패해도 다음 주기에 다시 시도하고, 세 번 연속 실패하면 현재 작업을 종료해 대기 작업이 새 환경에서 재시작하도록 합니다.

이 방식은 매 수집마다 GitHub 예약 실행을 기다릴 때 생기던 공백을 줄입니다. **GitHub의 실행 대기·장애, 작업 교대, 원본 갱신 지연 때문에 5분마다 모든 집계를 빠짐없이 얻는 것을 보장하지는 않습니다.** 실제 원본 집계 시각을 그래프의 x축에 사용합니다.

화면 배포는 별도 워크플로가 담당합니다. 화면 코드 변경 시 배포하고, 6시간마다 오프라인 대체 사본도 새로 배포합니다. 최신 기록은 이 배포를 기다리지 않습니다. 두 워크플로 모두 저장소가 공개일 때만 실행하도록 제한했으며, 표준 `ubuntu-latest`를 사용합니다. 배포 아티팩트 보관 기간은 1일입니다.

수집 종료는 저장소 Settings → Secrets and variables → Actions → Variables에 `COLLECT_UNTIL` 값을 ISO 시각(예: `2026-10-20T00:10:00+09:00`)으로 설정합니다. 이 예시 날짜는 종료일을 검증한 값이 아닙니다. 운영자가 확인한 실제 종료 시각을 입력하세요. 종료 후에는 워크플로도 비활성화하면 불필요한 실행이 멈춥니다.

## 상시 실행 수집기

Python 3.10 이상 환경에서:

```sh
python -m pip install -r collector/requirements.txt
python -m playwright install chromium
python collector/collect.py --every 300
```

이 모드는 실행한 컴퓨터가 켜져 있어야 합니다. 로컬 `dist/data` 파일을 갱신하며 GitHub에 자동 전송하지 않습니다. 웹 서버가 같은 `dist` 폴더를 제공하는 경우 바로 반영됩니다. GitHub Pages 운영은 Actions 방식을 사용하세요.

계정이나 비밀번호는 사용하지 않습니다. 로그인하지 않은 새 브라우저에서 공개 투표 페이지를 읽습니다. 로그인·캡차·접속 제한이 나타나면 오류로 중단하며 우회하지 않습니다.

## 데이터 처리

- 점유율: 팀 득표수 ÷ 전체 투표수 × 100. 카드에는 원본 표시 비율, 그래프와 증감에는 정확한 계산값을 사용합니다.
- 득표수·점유율 그래프: 최신 상위 3팀의 팀별 기록. 과거에 상위 3위 밖이었다면 값이 없습니다.
- 표차 그래프: 각 시점의 순위끼리 비교합니다. 순위가 바뀌면 그 순위를 차지하는 팀도 바뀝니다.
- 직전 관측 대비 변화: 가장 최근 관측과 바로 직전 관측의 표수·점유율을 같은 팀 ID로 비교합니다. 실제 관측 간격과 비교 시각을 표시하며, 직전 상위 3위 밖이던 팀은 —로 표시합니다.
- 화면 그래프와 PNG: 관측점 사이의 미관측 구간도 직선 연결합니다. 실제 관측점에만 점·툴팁이 있으며 CSV에 가상 관측값을 추가하지 않습니다.
- 같은 원본 시각은 중복 기록하지 않습니다. 같은 시각에 서로 다른 수치가 들어오면 검토할 수 있도록 오류를 표시합니다.
- 오래되거나 읽기에 실패한 값은 정상 갱신으로 표시하지 않습니다.
- 방문자는 공통 기록을 보기만 하며 데이터를 수정할 수 없습니다.

## 파일

- `dist/`: 외부 빌드 도구 없이 동작하는 정적 웹사이트.
- `collector/collect.py`: 공개 화면 텍스트 파싱, 검증, 시간별 기록 보존.
- `collector/runner.py`: 고정 5분 시계와 기록 커밋, 제한 시간 종료.
- `.github/workflows/collect-and-publish.yml`: 연속 수집과 다음 실행 대기.
- `.github/workflows/publish.yml`: 화면 코드와 대체 사본 Pages 배포.
- `collector/test_collect.py`, `collector/test_runner.py`: 수치 검증과 반복 주기·실패 후 재시도·종료 검증.

공식 데이터: https://berriz.in/ko/vote/2026kgma/

GitHub 예약 작업 설명: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Playwright Python: https://playwright.dev/python/docs/intro

## 수집 중지와 사이트 종료

- **수집만 중지:** 저장소 Actions → Collect KGMA votes continuously → 우측 `…` → Disable workflow. **실행 중인 작업과 대기 중인 작업도 각각 Cancel workflow로 취소**합니다. 이미 시작한 작업은 비활성화만으로 종료되지 않습니다. 대기 작업 시작까지 막으려면 Actions Variables에 `COLLECT_ENABLED=false`도 설정할 수 있습니다. 기존 사이트와 기록은 남습니다.
- **웹사이트도 내리기:** 먼저 수집을 중지하고 Publish KGMA dashboard도 Disable workflow로 비활성화한 다음 Settings → Pages → Source를 Deploy from a branch로 변경 → Branch를 None으로 선택 → Save. 저장소의 코드와 기록은 남습니다.
- **저장소까지 삭제:** Settings → General → Danger Zone → Delete this repository. 이 프로젝트의 코드·수집 기록·사이트가 함께 삭제되므로 보관할 자료가 있으면 먼저 내려받습니다.

현재 구성은 공개 저장소의 표준 `ubuntu-latest` 실행 환경과 GitHub Pages를 사용합니다. 표준 실행 시간과 Pages 호스팅은 무료로 이용할 수 있습니다. 별도 유료 서버나 AI API를 사용하지 않습니다. 저장 공간·캐시의 무료 한도와 유료 설정 변경은 별도 조건을 따릅니다.

공식 안내: https://docs.github.com/en/billing/concepts/product-billing/github-actions
