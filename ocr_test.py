import json
import mimetypes
import os
import sys
import time
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv


# 현재 프로젝트의 .env 불러오기
load_dotenv()

OCR_URL = os.getenv("NAVER_OCR_URL")
OCR_SECRET = os.getenv("NAVER_OCR_SECRET")

if not OCR_URL or not OCR_SECRET:
    raise RuntimeError(
        ".env에서 NAVER_OCR_URL 또는 NAVER_OCR_SECRET을 찾지 못했습니다."
    )


def run_ocr(image_path: str) -> dict:
    path = Path(image_path)

    if not path.is_file():
        raise FileNotFoundError(f"이미지 파일이 없습니다: {path}")

    image_format = path.suffix.lower().lstrip(".")

    if image_format == "jpeg":
        image_format = "jpg"

    if image_format not in {"jpg", "png", "pdf", "tif", "tiff"}:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {image_format}")

    message = {
        "version": "V2",
        "requestId": str(uuid.uuid4()),
        "timestamp": int(time.time() * 1000),
        "lang": "ko",
        "images": [
            {
                "format": image_format,
                "name": path.stem,
            }
        ],
    }

    mime_type = (
        mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )

    with path.open("rb") as image_file:
        response = requests.post(
            OCR_URL,
            headers={
                "X-OCR-SECRET": OCR_SECRET,
            },
            data={
                "message": json.dumps(message),
            },
            files={
                "file": (path.name, image_file, mime_type),
            },
            timeout=60,
        )

    if not response.ok:
        raise RuntimeError(
            f"OCR 호출 실패 ({response.status_code})\n"
            f"{response.text}"
        )

    return response.json()


def extract_text(result: dict) -> str:
    lines = []
    current_line = []

    for image in result.get("images", []):
        for field in image.get("fields", []):
            text = field.get("inferText", "").strip()

            if text:
                current_line.append(text)

            if field.get("lineBreak") and current_line:
                lines.append(" ".join(current_line))
                current_line = []

    if current_line:
        lines.append(" ".join(current_line))

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("사용법: python ocr_test.py 이미지경로")

    result = run_ocr(sys.argv[1])
    print(extract_text(result))