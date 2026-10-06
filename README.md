# KGMA TOP 3 — VOTE/TRACK

2026 KGMA Berriz 공개 투표 화면의 상위 3팀을 기록하고 시각화합니다.

## 현재 확인된 상태

- 초기 데이터는 사용자 캡처의 **2026-10-07 00:15 KST** 실제 수치 1건입니다.
- 총 11,195표: RESCENE 3,279표, RIIZE 2,895표, SHOWNU X HYUNGWON 839표.
- 첫 기록의 표차: 1–2위 384표, 2–3위 2,056표, 1–3위 2,440표.
- **GitHub Actions에서 실제 공개 페이지 수집과 기록 저장을 확인했습니다.** 첫 성공은 2026-10-07 00:51 KST이며, 원본 집계 시각 00:45 KST의 RESCENE 3,506표, RIIZE 3,091표, SHOWNU X HYUNGWON 892표를 저장했습니다. 작업 환경과 달리 GitHub 실행 환경에서 원본에 정상 접속했습니다.
- 확인되지 않은 과거 데이터는 포함하지 않았습니다. 수집이 빠진 구간도 보간하지 않습니다.

## 화면 열기

`dist/index.html`을 열면 첫 기록을 바로 볼 수 있습니다. 웹 서버 또는 GitHub Pages에서는 `dist/data/history.json`을 5분마다 다시 읽습니다. **페이지 새로고침과 데이터 수집은 별개입니다.** 방문자가 없어도 수집하려면 아래 수집기를 별도로 실행해야 합니다.

## 공개 운영 — GitHub Pages + Actions

1. 이 프로젝트를 새 공개 GitHub 저장소의 `main` 브랜치에 올립니다. `.github/workflows` 폴더도 포함합니다.
2. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 설정합니다.
3. Actions → **Collect KGMA votes and publish** → Run workflow를 한 번 실행합니다.
4. 수집 성공 로그의 `sourceAt`과 공식 페이지를 비교합니다. Pages가 활성화된 이후에는 수집 실패 시에도 마지막으로 검증된 기록과 오류 상태를 게시합니다. 과거 값을 0이나 가짜 값으로 바꾸지 않습니다.
5. 게시 작업에 표시되는 `https://사용자명.github.io/저장소명/` 주소를 공유합니다.

예약식은 `2-59/5 * * * *`입니다. 매시 02, 07, 12분 …에 실행을 요청하지만 **GitHub 예약 작업은 지연·누락될 수 있고 5분 정시 수집을 보장하지 않습니다**. 정확한 5분 간격이 필요하면 아래 상시 실행 방식 또는 별도 서버가 필요합니다. 실제 원본 집계 시각을 그래프의 x축에 사용합니다.

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
- 5분 증가량: 정확히 5분 전 원본 시각의 기록이 있을 때만 계산합니다.
- 같은 원본 시각은 중복 기록하지 않습니다. 같은 시각에 서로 다른 수치가 들어오면 검토할 수 있도록 오류를 표시합니다.
- 오래되거나 읽기에 실패한 값은 정상 갱신으로 표시하지 않습니다.
- 방문자는 공통 기록을 보기만 하며 데이터를 수정할 수 없습니다.

## 파일

- `dist/`: 외부 빌드 도구 없이 동작하는 정적 웹사이트.
- `collector/collect.py`: 공개 화면 텍스트 파싱, 검증, 시간별 기록 보존.
- `.github/workflows/collect-and-publish.yml`: 예약 수집과 Pages 배포.
- `collector/test_collect.py`: 표수·비율·중복·시각 오류 검증.

공식 데이터: https://berriz.in/ko/vote/2026kgma/

GitHub 예약 작업 설명: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Playwright Python: https://playwright.dev/python/docs/intro
