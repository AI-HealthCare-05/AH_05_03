import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
import cv2
import numpy as np

import requests
from dotenv import load_dotenv

# .env
# NAVER_OCR_URL=받은_Invoke_URL
# NAVER_OCR_SECRET=받은_Secret_Key

load_dotenv()

OCR_URL = os.getenv("NAVER_OCR_URL")
OCR_SECRET = os.getenv("NAVER_OCR_SECRET")

TARGET_KEYWORDS = [
    "공복혈당",
    "공복할당",  # OCR 오인식 대비
    "혈색소",
    "총콜레스테롤",
    "HDL",
    "LDL",
    "중성지방",
    "크레아티닌",
    "AST",
    "ALT",
    "감마지티피",
    "e-GFR",
]

# 이미지 기울기 보정
import cv2
import numpy as np
from pathlib import Path


def preprocess_image(image_path: str) -> str:
    """
    이미지 전처리

    1. 그레이스케일 변환
    2. 노이즈 제거
    3. 이진화
    4. 기울기 보정
    5. 보정된 이미지 저장

    반환값:
        보정된 이미지의 경로
    """

    path = Path(image_path)
    image = cv2.imread(str(path))

    if image is None:
        raise FileNotFoundError(
            f"이미지를 읽을 수 없습니다: {image_path}"
        )

    # 1. 그레이스케일
    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY,
    )

    # 2. 노이즈 제거
    blurred = cv2.GaussianBlur(
        gray,
        (5, 5),
        0,
    )

    # 3. 이진화
    thresh = cv2.threshold(
        blurred,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )[1]

    # 글자를 흰색으로 변환
    thresh = cv2.bitwise_not(thresh)

    # 4. 기울기 계산
    coords = np.column_stack(
        np.where(thresh > 0)
    )

    angle = cv2.minAreaRect(
        coords
    )[-1]

    if angle < -45:
        angle = -(90 + angle)

    else:
        angle = -angle

    # 5. 회전
    (h, w) = image.shape[:2]

    center = (
        w // 2,
        h // 2,
    )

    matrix = cv2.getRotationMatrix2D(
        center,
        angle,
        1.0,
    )
    corrected = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)

    # corrected = cv2.warpAffine(
    #     image,
    #     matrix,
    #     (w, h),
    #     flags=cv2.INTER_CUBIC,
    #     borderMode=cv2.BORDER_REPLICATE,
    # )

    # 6. 파일 저장
    output_path = (
        path.parent
        / f"corrected_{path.stem}.jpg"
    )

    cv2.imwrite(
        str(output_path),
        corrected,
    )

    print(
        f"보정된 이미지 저장: {output_path}"
    )
    print(f"회전 각도: {angle}")

    return str(output_path)



def naver_ocr(image_path: str, lang: str = "ko") -> str:
    """이미지에서 표를 인식하고 셀 단위 텍스트를 추출합니다."""

    # 1. OCR 환경변수 확인
    if not OCR_URL or not OCR_SECRET:
        raise RuntimeError(
            ".env에 NAVER_OCR_URL과 NAVER_OCR_SECRET을 설정하세요."
        )

    path = Path(image_path)

    if not path.is_file():
        raise FileNotFoundError(
            f"파일을 찾을 수 없습니다: {path}"
        )

    image_format = path.suffix.lower().lstrip(".")

    if image_format == "jpeg":
        image_format = "jpg"

    # 2. NAVER OCR 요청 정보
    message = {
        "version": "V2",
        "requestId": str(uuid.uuid4()),
        "timestamp": int(time.time() * 1000),
        "lang": lang,

        # ★ 표 인식 활성화
        "enableTableDetection": True,

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

    # 3. OCR API 호출
    with path.open("rb") as image_file:
        response = requests.post(
            OCR_URL,
            headers={
                "X-OCR-SECRET": OCR_SECRET
            },
            data={
                "message": json.dumps(message)
            },
            files={
                "file": (
                    path.name,
                    image_file,
                    mime_type,
                )
            },
            timeout=60,
        )

    # 4. API 오류 처리
    if not response.ok:
        raise RuntimeError(
            f"OCR 호출 실패 "
            f"({response.status_code}): "
            f"{response.text}"
        )

    result = response.json()

    # 최종 출력할 행들
    output_lines = []

    # 5. OCR이 인식한 이미지 확인
    for image in result.get("images", []):

        if image.get("inferResult") != "SUCCESS":
            continue

        tables = image.get("tables", [])

        # 표를 발견하지 못한 경우
        if not tables:
            output_lines.append(
                "[표를 인식하지 못했습니다.]"
            )
            continue

        # 6. 인식된 표 순회
        for table_index, table in enumerate(tables):

            output_lines.append(
                f"\n===== TABLE {table_index + 1} ====="
            )

            cells = table.get("cells", [])

            # 셀을 행/열 순서대로 정렬
            cells = sorted(
                cells,
                key=lambda cell: (
                    cell.get("rowIndex", 0),
                    cell.get("columnIndex", 0),
                ),
            )

            current_row = None
            row_values = []

            # 7. 각 셀의 내용 추출
            for cell in cells:

                row_index = cell.get("rowIndex", 0)

                # 새로운 행으로 넘어갔을 때
                if (
                    current_row is not None
                    and row_index != current_row
                ):
                    output_lines.append(
                        " | ".join(row_values)
                    )
                    row_values = []

                current_row = row_index

                cell_words = []

                # 셀 안의 문장
                for line in cell.get(
                    "cellTextLines", []
                ):

                    # 문장 안의 단어
                    for word in line.get(
                        "cellWords", []
                    ):
                        text = (
                            word
                            .get("inferText", "")
                            .strip()
                        )

                        if text:
                            cell_words.append(text)

                cell_text = " ".join(cell_words)

                # 빈 셀도 열 위치 보존
                row_values.append(cell_text)

            # 마지막 행 추가
            if row_values:
                output_lines.append(
                    " | ".join(row_values)
                )

    return "\n".join(output_lines)


# 이미지 보정후 ocr전달
processed_image = preprocess_image(
    "sample3.jpeg"
)

text = naver_ocr(
    processed_image
)

print(text)
