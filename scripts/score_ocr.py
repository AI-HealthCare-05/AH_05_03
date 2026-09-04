"""OCR 채점기 — 합성 검진표 정답과 실제 파이프라인 출력을 대조한다.

무엇을 재는가
-------------
검사명 문자열을 맞혔는지가 아니라 **수치가 올바른 칸에 들어갔는지**를 잰다. 화면에
꽂히는 것이 DTO 키(`hdl`·`ldl`·…)이고, 이름을 근사하게 읽어도 엉뚱한 칸에 넣으면
사용자에게는 그냥 틀린 값이기 때문이다.

세 가지를 따로 센다. 하나로 합치면 성격이 다른 실패가 서로를 가린다.

    잡음(recall)      정답에 있는 수치 중 몇 개를 꺼냈나
    정확(precision)   꺼낸 수치 중 몇 개가 정답과 같은가
    오배정(misroute)  **다른 칸에** 넣은 것. 가장 비싼 실패다

오배정을 따로 세는 이유가 있다. 못 꺼낸 값은 화면이 "안 넣음" 으로 표시하고 사용자가
채울 수 있지만, 잘못 배정된 값은 **틀린 채로 판정까지 간다.** 기록된 사례가
`요소질소`(참고치 8~20)를 `요산`(2.5~9.5)으로 읽은 것이고, 그래서 정답 세트에 사전에
없는 항목(`총단백`·`총빌리루빈`·`BUN`)을 일부러 섞어 두었다.

    uv run python scripts/score_ocr.py --limit 6
    uv run python scripts/score_ocr.py --report artifacts/ocr_score.json
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
TRUTH = ROOT / "modeling" / "data" / "ocr_eval" / "truth.json"

#: 값이 같다고 볼 허용 오차. 상대 오차로 본다 — `urine_acr` 250 과 `hba1c` 5.4 에
#: 같은 절대 허용치를 쓸 수 없다. 0 은 절대 오차로 떨어뜨린다.
REL_TOLERANCE = 0.005


def close_enough(expected: float, actual: float) -> bool:
    if expected == 0:
        return abs(actual) < 1e-9
    return abs(actual - expected) / abs(expected) <= REL_TOLERANCE


def login(client: httpx.Client) -> None:
    email = f"ocr-score-{uuid.uuid4().hex[:10]}@example.com"
    client.post("/api/v1/auth/signup", json={"email": email, "password": "Password123!"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"}).json()["data"][
        "access_token"
    ]
    client.headers["Authorization"] = f"Bearer {token}"


def recognize(client: httpx.Client, path: Path) -> tuple[dict[str, float], float, str | None]:
    """`(수치, 소요 ms, 오류)`. 실패해도 던지지 않는다 — 한 장 때문에 세트가 멈추면 안 된다."""
    started = time.perf_counter()
    with path.open("rb") as handle:
        response = client.post(
            "/api/v1/dev/ocr/recognize",
            files={"file": (path.name, handle, "image/jpeg")},
        )
    elapsed = (time.perf_counter() - started) * 1000
    if response.status_code != 200:
        return {}, elapsed, f"HTTP {response.status_code} {response.text[:120]}"
    data = response.json().get("data") or {}
    values = (data.get("measurements") or {}).get("values") or {}
    return {k: float(v) for k, v in values.items() if isinstance(v, (int, float))}, elapsed, None


def score(truth: dict[str, Any], limit: int | None, base_url: str) -> dict[str, Any]:
    documents = truth["documents"][: limit or len(truth["documents"])]
    per_key: dict[str, dict[str, int]] = defaultdict(lambda: {"expected": 0, "got": 0, "exact": 0, "wrong": 0})
    misroutes: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    latencies: list[float] = []
    totals = {"expected": 0, "returned": 0, "exact": 0, "wrong_value": 0, "misrouted": 0, "missed": 0}

    with httpx.Client(base_url=base_url, timeout=240.0) as client:
        login(client)
        for doc in documents:
            path = TRUTH.parent / doc["image"]
            got, elapsed, error = recognize(client, path)
            latencies.append(elapsed)
            if error:
                failures.append({"doc_id": doc["doc_id"], "error": error})
                continue

            expected: dict[str, float] = doc["measurements"]
            extras: dict[str, float] = doc["extras"]
            for key, want in expected.items():
                per_key[key]["expected"] += 1
                totals["expected"] += 1
                if key not in got:
                    totals["missed"] += 1
                    continue
                per_key[key]["got"] += 1
                if close_enough(want, got[key]):
                    per_key[key]["exact"] += 1
                    totals["exact"] += 1
                else:
                    per_key[key]["wrong"] += 1
                    totals["wrong_value"] += 1

            totals["returned"] += len(got)
            # 정답에 없는 칸에 값이 들어왔다. 사전에 없는 항목의 값과 같으면
            # **오배정**이다 — 이름을 잘못 읽어 다른 칸에 넣은 것이다.
            for key, value in got.items():
                if key in expected:
                    continue
                source = next((name for name, v in extras.items() if close_enough(v, value)), None)
                totals["misrouted"] += 1
                misroutes.append(
                    {
                        "doc_id": doc["doc_id"],
                        "put_into": key,
                        "value": value,
                        "looks_like": source or "정답에 없는 값",
                    }
                )

    returned = totals["exact"] + totals["wrong_value"] + totals["misrouted"]
    return {
        "documents": len(documents),
        "totals": totals,
        "recall": round(totals["exact"] / totals["expected"], 4) if totals["expected"] else 0.0,
        "precision": round(totals["exact"] / returned, 4) if returned else 0.0,
        "latency_ms_median": round(sorted(latencies)[len(latencies) // 2], 1) if latencies else None,
        "per_key": {
            key: {
                **counts,
                "recall": round(counts["exact"] / counts["expected"], 3) if counts["expected"] else 0.0,
            }
            for key, counts in sorted(per_key.items())
        },
        "misroutes": misroutes,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--truth", type=Path, default=TRUTH)
    parser.add_argument("--limit", type=int, default=None, help="앞에서 N장만. API 비용을 묶을 때")
    parser.add_argument("--base-url", default="http://127.0.0.1:80")
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()

    if not args.truth.is_file():
        print(f"정답 파일이 없습니다: {args.truth}")
        print("먼저 만드세요 — uv run python modeling/data/make_ocr_eval_set.py")
        return 1

    truth = json.loads(args.truth.read_text(encoding="utf-8"))
    result = score(truth, args.limit, args.base_url)

    t = result["totals"]
    print(f"문서 {result['documents']}장 · 정답 수치 {t['expected']}개 · 중앙값 {result['latency_ms_median']}ms\n")
    print(f"  재현율(꺼내서 맞힘)   {result['recall']:.1%}   {t['exact']}/{t['expected']}")
    print(f"  정확도(꺼낸 것 중)    {result['precision']:.1%}")
    print(f"  못 꺼냄               {t['missed']}")
    print(f"  값이 틀림             {t['wrong_value']}")
    print(f"  **다른 칸에 넣음**    {t['misrouted']}")
    if result["failures"]:
        print(f"  요청 실패             {len(result['failures'])}")

    weak = [(k, v) for k, v in result["per_key"].items() if v["recall"] < 0.9 and v["expected"] >= 3]
    if weak:
        print("\n재현율이 낮은 항목")
        for key, counts in sorted(weak, key=lambda kv: kv[1]["recall"]):
            print(f"  {key:<18} {counts['recall']:.0%}  ({counts['exact']}/{counts['expected']})")
    for row in result["misroutes"][:8]:
        print(f"\n  오배정 {row['doc_id']}: {row['value']} 를 '{row['put_into']}' 로 — {row['looks_like']}")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n-> {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
