# 다음 팬 투표용 트래커 준비

KGMA 트래커의 **그래프·캔들차트·시간대별 증가량·CSV·박스별 PNG** 화면을 새 공개 투표에 옮기기 위한 생성기입니다. 운영 중인 KGMA 사이트와 기록은 수정하지 않습니다.

다음에 공식 투표 현황 페이지 주소를 받으면, 먼저 공개 결과의 요청 방식·원본 집계 시각·전체 표수·팀별 표수와 안정적인 팀 ID를 확인합니다. 그 결과에 맞춰 `collector/source_adapter.py`를 구현하고 실제 응답의 값과 화면의 값을 대조합니다. **URL만으로 모든 투표 사이트의 구조와 접근 가능성을 미리 보장할 수는 없습니다.** 로그인이 필요한 수치, 미공개 집계, 우회가 필요한 제한은 수집 대상으로 삼지 않습니다.

## 새 사본 만들기

이 저장소 전체를 체크아웃한 폴더에서 실행합니다. `--output`은 현재 저장소 바깥의 존재하지 않는 폴더여야 합니다.

```sh
python reuse/new_tracker.py \
  --output ../next-vote-tracker \
  --repository OWNER/NEW-REPO \
  --vote-url 'https://official.example/vote/results' \
  --title '새 투표 이름' \
  --source-name '공식 주최자' \
  --target-id rescene \
  --target-name '리센느' \
  --slug next-vote \
  --end-at 'YYYY-MM-DDTHH:MM:SS+09:00'
```

실제 URL, 저장소 이름, 종료 시각, 팀 ID를 확인한 뒤 입력합니다. 종료 시각은 생성 시점부터 14일 이내여야 합니다. 더 긴 투표는 기록 수와 실행 시간을 따로 계산한 뒤 제한을 변경합니다. 예시 주소는 실행 가능한 실제 소스가 아닙니다.

출력 폴더에 새 `README.md`와 수집 계약·비활성 워크플로가 생성됩니다. 과거 KGMA 기록은 복사하지 않으며, 실제 관측값 없이는 게시 단계가 실패합니다. 새 투표의 실제 응답에 맞는 수집 연결 및 검증 뒤 새 공개 저장소에 올립니다. GitHub Pages Source를 GitHub Actions로 설정하고 `PUBLISH_ENABLED=true`를 지정한 뒤 게시 작업을 실행합니다. 수집은 별도 저장소 Actions variable `COLLECT_ENABLED=true`를 설정하기 전까지 시작되지 않습니다.

기존 KGMA 코드에는 베리즈 전용 파서, URL, 팀 이름, 종료 시각이 들어 있어 파일을 그대로 복사하면 잘못된 데이터가 섞입니다. 생성기는 이 부분을 분리합니다. 상위 2팀만 저장하는 원본 스키마이므로 대상 팀이 3위 이하이면 대상 팀의 표차·캔들 관측점이 비게 됩니다. 투표 형식에 따라 후보 전원 저장, 다른 집계 기준, 실제 갱신 간격, 차단 없는 제공 방식이 필요한지는 URL을 받은 다음 판단합니다.

검증: `python -m unittest discover -s reuse -p 'test_*.py'` (기본 Python), `node qa/test_axis.cjs`와 `node qa/test_hourly.cjs` (생성된 폴더). 원본에 종속된 모바일 화면 검사는 새 데이터로 다시 확인한 뒤 게시 절차에 넣습니다.
