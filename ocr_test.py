import json
import mimetypes
import os
import time
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv


# .env
# NAVER_OCR_URL=받은_Invoke_URL
# NAVER_OCR_SECRET=받은_Secret_Key

load_dotenv()

OCR_URL = os.getenv("NAVER_OCR_URL")
OCR_SECRET = os.getenv("NAVER_OCR_SECRET")


def naver_ocr(image_path: str, lang: str = "ko") -> str:
    """이미지 파일에서 텍스트를 추출합니다."""

    if not OCR_URL or not OCR_SECRET:
        raise RuntimeError(
            ".env에 NAVER_OCR_URL과 NAVER_OCR_SECRET을 설정하세요."
        )

    path = Path(image_path)

    if not path.is_file():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {path}")

    image_format = path.suffix.lower().lstrip(".")

    if image_format == "jpeg":
        image_format = "jpg"

    message = {
        "version": "V2",
        "requestId": str(uuid.uuid4()),
        "timestamp": int(time.time() * 1000),
        "lang": lang,
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
            headers={"X-OCR-SECRET": OCR_SECRET},
            data={"message": json.dumps(message)},
            files={
                "file": (path.name, image_file, mime_type),
            },
            timeout=60,
        )

    if not response.ok:
        raise RuntimeError(
            f"OCR 호출 실패 ({response.status_code}): "
            f"{response.text}"
        )

    result = response.json()
    lines = []

    for image in result.get("images", []):
        current_line = []

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


# 사용 예시
text = naver_ocr("sample.jpeg")
print(text)