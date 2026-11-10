# 음색 샘플 출처와 라이선스

연습실의 "샘플" 음색은 아래 자료를 잘라 내고(길이·페이드), 음량을 맞추고, 일부는 필터를 걸어 MP3(44.1 kHz, 128 kbps)로 다시 인코딩한 것입니다. 원본 파일을 그대로 싣지 않았고, 아래 CC-BY 자료는 변형되었습니다. 추천이나 보증을 뜻하지 않습니다.

## 저작자 표시가 필요한 자료 (CC BY)

| 쓰임 | 자료 | 저작자 | 라이선스 | 변형 내용 |
|---|---|---|---|---|
| 건반 | Salamander Grand Piano V3 (Yamaha C5) | Alexander Holm. 재조율판 Markus Fiedler, SFZ 재구성 kinwie | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3반음 간격 30음 x 2개 벨로시티 층만 사용, 2.5초로 자르고 페이드, 고음역 셸프 -6 dB(3.5 kHz)와 9.5 kHz 로우패스 적용, 스테레오 유지 |
| 드럼 중 킥 | MuldjordKit (DrumGizmo) | Lars Muldjord (www.muldjord.com, www.drumgizmo.org), SFZ 매핑 kinwie | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 킥 두 번의 타격을 여러 마이크(근접·오버헤드·앰비언스)로 섞어 모노 합성, 0.9초로 자름 |

## 퍼블릭 도메인 헌정 자료 (CC0 1.0)

저작자 표시는 의무가 아니지만 감사의 뜻으로 적습니다.

| 쓰임 | 자료 | 저작자 |
|---|---|---|
| 드럼 중 스네어·하이햇·라이드·크래시 | Virtuosity Drums v0.925 | Versilian Studios, Karoryfer Samples (다중 마이크 믹스, 모노) |
| 베이스 | Finger Bass YR (FreePats) | Andrea Biasior (Yamaha RBX 베이스), FreePats 정리 Roberto Gordo Saez |
| 기타 | Emily the Strange 일렉트릭 기타 DI | D. Smolken, Karoryfer Lecolds (CC0, 로열티 없음) |

## 대표 샘플 3곡의 렌더 음원

`audio/nova.mp3`, `audio/summersong.mp3`, `audio/eot.mp3`와 `audio/stems/*.mp3`(파트별로 나눈 소리)는 이 프로젝트에서 직접 설계한 신스로 렌더한 4마디 커버 반주입니다. 원곡 녹음은 들어 있지 않으며, 위 표의 자료는 이 음원이 아니라 `samples/` 폴더의 음색 조각(앱의 합성 반주 「샘플 음색」)에만 쓰였습니다.

## 만든 방법

`experiments/experiment_j/web_practice_room/samplebuild/build_samples.py` 로 만듭니다. 쓰는 파일만 골라 처리하며 원본 폴더는 수정하지 않습니다.
