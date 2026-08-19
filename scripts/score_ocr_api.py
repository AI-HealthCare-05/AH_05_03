"""합성 픽스처 3종을 실제 HTTP API에 올려 인식 정확도를 채점한다.

`frontend/scripts/score-fixtures.ts`는 라이브러리를 직접 호출하지만
이 스크립트는 `POST /api/v1/documents/ocr`을 그대로 태운다. 인증·업로드
검증·응답 봉투까지 포함한 실제 경로를 재는 것이 목적이다.

실행:
    uv run --group ocr python scripts/score_ocr_api.py [BASE_URL]
    # 기본값 http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "frontend" / "fixtures"
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api/v1"
PASSWORD = "OcrScore1!"
CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def login(client: httpx.Client) -> dict[str, str]:
    email = f"ocr-score-{int(time.time())}@example.com"
    client.post(f"{API}/auth/signup", json={"email": email, "password": PASSWORD})
    response = client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def main() -> int:
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    total_correct = total_items = total_wrong_auto = 0

    with httpx.Client(timeout=120.0) as client:
        headers = login(client)
        print(f"대상 {BASE}\n")

        for entry in manifest:
            path = FIXTURES / entry["file"]
            with path.open("rb") as fp:
                response = client.post(
                    f"{API}/documents/ocr",
                    headers=headers,
                    files={"file": (path.name, fp, CONTENT_TYPES[path.suffix.lower()])},
                )
            if response.status_code != 200:
                print(f"=== {entry['title']} — HTTP {response.status_code} {response.text[:120]}")
                total_items += len(entry["truth"])
                continue

            data = response.json()["data"]
            rows = {r["item_code"]: r for r in data["rows"] if r["item_code"]}
            date_ok = data["measured_date"] == entry["measuredDate"]

            print(f"=== {entry['title']} ({entry['file']}) ===")
            print(
                f"검진일 {data['measured_date']} {'O' if date_ok else 'X'}"
                f" · {data['elapsed_ms']}ms · 이미지폐기 {data['image_discarded']}"
            )
            print(f"{'항목':<16}{'추출':>8}{'정답':>8}{'신뢰도':>7}  판정      단서")
            print("-" * 66)

            correct = wrong_auto = 0
            for code, truth in entry["truth"].items():
                row = rows.get(code)
                hit = row is not None and row["value"] == truth
                correct += hit
                if row and not row["needs_review"] and not hit:
                    wrong_auto += 1
                verdict = "미탐지" if row is None else ("확인필요" if row["needs_review"] else "자동확정")
                label = row["item_label"] if row else code
                shown = str(row["value"]) if row else "-"
                conf = format(row["confidence"], ".2f") if row else "-"
                signals = ",".join(row["signals"]) if row else ""
                mark = "O" if hit else "X"
                print(f"{label:<16}{shown:>8}{truth:>8}{conf:>7}  {mark} {verdict:<8}{signals}")

            items = len(entry["truth"])
            print("-" * 66)
            print(
                f"정확 {correct}/{items} · 자동확정 {data['auto_confirmable']}"
                f" · 확인필요 {data['needs_review']} · 오답자동확정 {wrong_auto}\n"
            )
            total_correct += correct
            total_items += items
            total_wrong_auto += wrong_auto

    print("=" * 66)
    print(f"합계 정확 {total_correct}/{total_items} · 오답자동확정 {total_wrong_auto}")
    if total_wrong_auto:
        print("오답이 자동확정됐습니다 — 신뢰도 임계값을 재조정해야 합니다.")
        return 1
    print("오답이 자동확정된 건이 없습니다.")
    return 0 if total_correct == total_items else 1


if __name__ == "__main__":
    sys.exit(main())
