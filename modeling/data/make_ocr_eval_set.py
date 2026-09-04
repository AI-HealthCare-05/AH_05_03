"""합성 검진결과지와 **정답**을 함께 만든다 — OCR 채점 데이터셋 v0.1.

왜 합성인가
-----------
44번 문서가 "전용 OCR 과의 비교는 채점 데이터셋 0 건이라 못 한다" 로 남겨 둔 자리다.
실제 검진표는 개인정보라 저장소에 못 넣고, 팀원끼리 돌려 볼 수도 없다. 합성이면
개인정보가 0 건이고 공유되며, 무엇보다 **정답을 생성 시점에 안다.**

16번 문서 §11.2 가 못 박은 규칙이 하나 있다 — *"Naver 결과를 정답으로 복사하지
않는다."* 엔진 출력을 정답으로 쓰면 그 엔진을 이길 수 없고, 두 엔진이 같이 틀린
경우를 영영 못 본다. 여기서는 값을 **먼저 뽑고 그 값으로 그림을 그리므로** 그
문제가 구조적으로 생기지 않는다.

무엇을 흔드는가
---------------
같은 값을 같은 판에 스무 번 그리면 스무 장이 한 장과 같다. 실제 검진표에서 갈리는
축만 골라 흔든다.

1. **이름** — 검사 하나에 별칭이 여럿이다(`중성지방` / `트리글리세라이드` / `TG`).
   매핑 사전(`app/services/ocr_measurements.py`)이 실제로 그걸 다 잡는지가 절반이다.
2. **판형** — 표 / 두 칸 나열 / 한 줄 나열. 표가 아닌 판형에서 값과 이름이 붙어
   버리는 것이 실제로 자주 나는 오독이다.
3. **참고치 인쇄 여부** — 인쇄돼 있으면 이름 오독을 잡는 관문이 하나 더 생긴다.
   없는 판형도 섞어야 그 관문 없이도 버티는지 알 수 있다.
4. **잡음** — JPEG 품질, 미세 회전, 배경 얼룩. 스캔본과 휴대폰 사진의 차이다.

정답에 무엇을 적는가
--------------------
`measurements` 는 **DTO 키로** 적는다. 화면에 실제로 꽂히는 것이 그것이고, 검사명
문자열을 맞혔는지가 아니라 *수치가 올바른 칸에 들어갔는지*가 이 제품의 성패다.
사전에 없는 검사(`총단백` 등)는 `extras` 에 두고 채점에서 재현율만 본다.

    uv run python modeling/data/make_ocr_eval_set.py --count 24
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "modeling" / "data" / "ocr_eval"

#: 윈도우 기본 한글 폰트. 없으면 PIL 기본 폰트로 떨어지는데 그때는 한글이 깨지므로
#: 만들지 않고 멈춘다 — 깨진 글자로 만든 데이터셋은 OCR 을 재는 게 아니라 폰트를 잰다.
FONT_CANDIDATES = (
    Path("C:/Windows/Fonts/malgun.ttf"),
    Path("C:/Windows/Fonts/malgunbd.ttf"),
    Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
    Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
)


@dataclass(frozen=True)
class Analyte:
    """검사 하나. `key` 가 없으면 매핑 사전에 없는 항목이라 채점에서 재현율만 본다."""

    key: str | None
    names: tuple[str, ...]
    unit: str
    low: float
    high: float
    decimals: int
    reference: str | None = None


#: 국가건강검진 결과지에 실제로 인쇄되는 항목. 범위는 정상~경계~이상을 고루 뽑도록
#: 넓게 잡았다 — 정상값만 있으면 판정 쪽 관문(참고치 대조)을 못 흔든다.
ANALYTES: tuple[Analyte, ...] = (
    Analyte("sbp", ("수축기혈압", "최고혈압", "수축기"), "mmHg", 95, 175, 0, "120 미만"),
    Analyte("dbp", ("이완기혈압", "최저혈압", "이완기"), "mmHg", 55, 110, 0, "80 미만"),
    Analyte("fasting_glucose", ("공복혈당", "공복 혈당", "혈당(공복)"), "mg/dL", 70, 190, 0, "100 미만"),
    Analyte("hba1c", ("당화혈색소", "당화혈색소(HbA1c)", "HbA1c"), "%", 4.5, 11.0, 1, "5.7 미만"),
    Analyte("total_chol", ("총콜레스테롤", "총 콜레스테롤", "T.CHOL"), "mg/dL", 120, 300, 0, "200 미만"),
    Analyte("hdl", ("HDL콜레스테롤", "고밀도지단백", "HDL-C"), "mg/dL", 25, 90, 0, "60 이상"),
    Analyte("ldl", ("LDL콜레스테롤", "저밀도지단백", "LDL-C"), "mg/dL", 50, 220, 0, "130 미만"),
    Analyte("triglyceride", ("중성지방", "트리글리세라이드", "TG"), "mg/dL", 40, 420, 0, "150 미만"),
    Analyte("ast", ("AST", "AST(SGOT)", "SGOT"), "IU/L", 10, 120, 0, "40 이하"),
    Analyte("alt", ("ALT", "ALT(SGPT)", "SGPT"), "IU/L", 8, 140, 0, "35 이하"),
    Analyte("ggt", ("감마지티피", "감마GTP", "γ-GTP"), "IU/L", 10, 220, 0, "63 이하"),
    Analyte("creatinine", ("크레아티닌", "혈청 크레아티닌", "Creatinine"), "mg/dL", 0.5, 2.2, 2, "1.5 이하"),
    Analyte("hemoglobin", ("혈색소", "헤모글로빈", "Hb"), "g/dL", 9.5, 17.5, 1, "13 이상"),
    Analyte("uric_acid", ("요산", "Uric acid"), "mg/dL", 2.5, 9.5, 1, "7.0 이하"),
    Analyte("albumin", ("알부민", "혈청 알부민"), "g/dL", 3.2, 5.4, 1, "3.5 이상"),
    Analyte("urine_acr", ("요알부민/크레아티닌비", "알부민크레아티닌비", "UACR"), "mg/g", 3, 320, 0, "30 미만"),
    # 사전에 없는 항목. 이것들이 다른 칸으로 잘못 들어가지 않는지가 관문 시험이다 —
    # 기록된 사례가 `요소질소`(참고치 8~20)를 `요산`(2.5~9.5)으로 읽은 것이다.
    Analyte(None, ("요소질소(BUN)", "혈중요소질소", "BUN"), "mg/dL", 6, 28, 0, "8~20"),
    Analyte(None, ("총단백", "Total protein"), "g/dL", 6.0, 8.5, 1, "6.0~8.0"),
    Analyte(None, ("총빌리루빈", "빌리루빈"), "mg/dL", 0.2, 2.0, 1, "1.2 이하"),
)

HOSPITALS = ("강서구보건소", "서울대학교병원 건강증진센터", "한국건강관리협회 서울서부지부", "OO내과의원")
LAYOUTS = ("table", "two_column", "inline")


@dataclass
class Sheet:
    """한 장의 정답. 이미지보다 이쪽이 먼저 정해진다."""

    doc_id: str
    layout: str
    hospital: str
    exam_date: str
    measurements: dict[str, float] = field(default_factory=dict)
    extras: dict[str, float] = field(default_factory=dict)
    printed: list[dict[str, Any]] = field(default_factory=list)
    noise: dict[str, Any] = field(default_factory=dict)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    raise SystemExit(
        "한글 폰트를 찾지 못했습니다. 깨진 글자로 만든 데이터셋은 OCR 이 아니라 폰트를 재게 됩니다.\n"
        f"찾아본 곳: {', '.join(str(p) for p in FONT_CANDIDATES)}"
    )


def draw_value(rng: random.Random, analyte: Analyte) -> float:
    raw = rng.uniform(analyte.low, analyte.high)
    return round(raw, analyte.decimals)


def format_value(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}" if decimals else f"{int(round(value))}"


def build_sheet(rng: random.Random, index: int) -> Sheet:
    """값을 먼저 뽑고 그림은 나중에 그린다 — 정답이 출력에서 나오지 않는 이유다."""
    picked = rng.sample(ANALYTES, k=rng.randint(8, 14))
    sheet = Sheet(
        doc_id=f"synth-{index:03d}",
        layout=rng.choice(LAYOUTS),
        hospital=rng.choice(HOSPITALS),
        exam_date=f"{rng.randint(2023, 2026)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        noise={
            "jpeg_quality": rng.choice([95, 80, 62]),
            "rotation_deg": round(rng.uniform(-0.8, 0.8), 2),
            "speckle": rng.choice([0, 0, 600]),
        },
    )
    with_reference = rng.random() < 0.65
    for analyte in picked:
        value = draw_value(rng, analyte)
        name = rng.choice(analyte.names)
        sheet.printed.append(
            {
                "printed_name": name,
                "key": analyte.key,
                "value": value,
                "unit": analyte.unit,
                "reference": analyte.reference if with_reference else None,
            }
        )
        if analyte.key:
            sheet.measurements[analyte.key] = value
        else:
            sheet.extras[name] = value
    return sheet


def _draw_table(draw: ImageDraw.ImageDraw, sheet: Sheet, y: int, width: int, body: Any, small: Any) -> None:
    for label, x in (("검사항목", 70), ("결과", 420), ("단위", 560), ("참고치", 700)):
        draw.text((x, y), label, font=small, fill="black")
    y += 28
    draw.line((60, y, width - 60, y), fill="gray", width=1)
    y += 14
    for row in sheet.printed:
        draw.text((70, y), str(row["printed_name"]), font=body, fill="black")
        draw.text((420, y), format_value(row["value"], _decimals(row)), font=body, fill="black")
        draw.text((560, y), str(row["unit"]), font=body, fill="black")
        if row["reference"]:
            draw.text((700, y), str(row["reference"]), font=body, fill="black")
        y += 40


def _draw_two_column(draw: ImageDraw.ImageDraw, sheet: Sheet, y: int, body: Any, small: Any) -> None:
    for i, row in enumerate(sheet.printed):
        col = i % 2
        if col == 0 and i:
            y += 46
        x = 70 + col * 470
        draw.text(
            (x, y),
            f"{row['printed_name']}: {format_value(row['value'], _decimals(row))} {row['unit']}",
            font=body,
            fill="black",
        )
        if row["reference"]:
            draw.text((x, y + 22), f"참고치 {row['reference']}", font=small, fill="gray")


def _draw_inline(draw: ImageDraw.ImageDraw, sheet: Sheet, y: int, body: Any) -> None:
    for row in sheet.printed:
        ref = f"  (참고치 {row['reference']})" if row["reference"] else ""
        draw.text(
            (70, y),
            f"{row['printed_name']} {format_value(row['value'], _decimals(row))} {row['unit']}{ref}",
            font=body,
            fill="black",
        )
        y += 42


def render(sheet: Sheet, font_path_size: int = 20) -> Image.Image:
    width, height = 1000, 1400
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    title = load_font(30)
    body = load_font(font_path_size)
    small = load_font(16)

    draw.text((60, 50), "건강검진 결과 통보서", font=title, fill="black")
    draw.text((60, 100), f"검사일자: {sheet.exam_date}", font=body, fill="black")
    draw.text((60, 130), f"검진기관: {sheet.hospital}", font=body, fill="black")
    draw.line((60, 165, width - 60, 165), fill="black", width=2)

    y = 195
    if sheet.layout == "table":
        _draw_table(draw, sheet, y, width, body, small)
    elif sheet.layout == "two_column":
        _draw_two_column(draw, sheet, y, body, small)
    else:
        _draw_inline(draw, sheet, y, body)

    draw.text((60, height - 70), "본 결과는 합성 데이터입니다. 실제 검진 결과가 아닙니다.", font=small, fill="gray")

    if sheet.noise["speckle"]:
        rng = random.Random(sheet.doc_id)
        for _ in range(sheet.noise["speckle"]):
            x, y2 = rng.randrange(width), rng.randrange(height)
            shade = rng.randrange(120, 210)
            draw.point((x, y2), fill=(shade, shade, shade))
    if sheet.noise["rotation_deg"]:
        image = image.rotate(sheet.noise["rotation_deg"], resample=Image.BICUBIC, fillcolor="white")
    return image


def _decimals(row: dict[str, Any]) -> int:
    value = row["value"]
    return 0 if float(value).is_integer() else (2 if round(value, 2) != round(value, 1) else 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=24, help="만들 장수 (44번 문서 권고 20~30)")
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    images_dir = args.out / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    manifest: list[dict[str, Any]] = []
    for index in range(1, args.count + 1):
        sheet = build_sheet(rng, index)
        image = render(sheet)
        path = images_dir / f"{sheet.doc_id}.jpg"
        image.save(path, "JPEG", quality=sheet.noise["jpeg_quality"])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
        manifest.append(
            {
                "doc_id": sheet.doc_id,
                "image": f"images/{path.name}",
                "sha256_16": digest,
                "layout": sheet.layout,
                "hospital": sheet.hospital,
                "exam_date": sheet.exam_date,
                "noise": sheet.noise,
                "measurements": sheet.measurements,
                "extras": sheet.extras,
                "printed": sheet.printed,
            }
        )

    payload = {
        "version": "0.1",
        "seed": args.seed,
        "generator": "modeling/data/make_ocr_eval_set.py",
        "note": (
            "합성 데이터. 개인정보 0건. 정답은 값을 먼저 뽑고 그림을 그려 만든 것이라 "
            "어떤 OCR 엔진의 출력도 정답에 섞여 있지 않다(16번 문서 §11.2)."
        ),
        "documents": manifest,
    }
    (args.out / "truth.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    keys = sorted({k for doc in manifest for k in doc["measurements"]})
    total = sum(len(doc["measurements"]) for doc in manifest)
    print(f"{len(manifest)}장 · 정답 수치 {total}개 · 서로 다른 항목 {len(keys)}종")
    print("판형 " + " · ".join(f"{name} {sum(1 for d in manifest if d['layout'] == name)}" for name in LAYOUTS))
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
