import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import requests
from dotenv import load_dotenv


# =========================================================
# 환경 변수
# =========================================================

load_dotenv()

OCR_URL = os.getenv("NAVER_OCR_URL")
OCR_SECRET = os.getenv("NAVER_OCR_SECRET")


# =========================================================
# NAVER OCR API 호출
# =========================================================

def call_naver_ocr(
    image_path: str,
    lang: str = "ko",
    table_detection: bool = False,
) -> dict:
    """
    NAVER OCR API를 호출하고 원본 JSON 결과를 반환합니다.

    table_detection=False
        → 일반 OCR
        → 문서 방향 판별 등에 사용

    table_detection=True
        → Table Detection 활성화
        → 표 구조 추출에 사용
    """

    if not OCR_URL or not OCR_SECRET:
        raise RuntimeError(
            ".env에 NAVER_OCR_URL과 "
            "NAVER_OCR_SECRET을 설정하세요."
        )

    path = Path(image_path)

    if not path.is_file():
        raise FileNotFoundError(
            f"파일을 찾을 수 없습니다: {path}"
        )

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

    if table_detection:
        message["enableTableDetection"] = True

    mime_type = (
        mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )

    try:
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
                    "file": (
                        path.name,
                        image_file,
                        mime_type,
                    )
                },
                timeout=60,
            )

    except requests.RequestException as error:
        raise RuntimeError(
            f"OCR 서버 연결 실패: {error}"
        ) from error

    if not response.ok:
        raise RuntimeError(
            f"OCR 호출 실패 "
            f"({response.status_code}): "
            f"{response.text}"
        )

    try:
        result = response.json()

    except ValueError as error:
        raise RuntimeError(
            "OCR 응답을 JSON으로 변환하지 못했습니다."
        ) from error

    images = result.get("images", [])

    if not images:
        raise RuntimeError(
            "OCR 응답에 이미지 결과가 없습니다."
        )

    successful = any(
        image.get("inferResult") == "SUCCESS"
        for image in images
    )

    if not successful:
        messages = [
            image.get("message", "")
            for image in images
        ]

        raise RuntimeError(
            f"OCR 인식 실패: {messages}"
        )

    return result


# =========================================================
# 이미지 회전
# =========================================================

def rotate_image(
    image,
    angle: int,
):
    """
    이미지를 0 / 90 / 180 / 270도로 회전합니다.

    angle은 원본 기준 시계방향 회전 각도입니다.
    """

    if angle == 0:
        return image.copy()

    if angle == 90:
        return cv2.rotate(
            image,
            cv2.ROTATE_90_CLOCKWISE,
        )

    if angle == 180:
        return cv2.rotate(
            image,
            cv2.ROTATE_180,
        )

    if angle == 270:
        return cv2.rotate(
            image,
            cv2.ROTATE_90_COUNTERCLOCKWISE,
        )

    raise ValueError(
        "angle은 0, 90, 180, 270 중 하나여야 합니다."
    )


# =========================================================
# 방향 판별용 OCR 점수
# =========================================================

def calculate_ocr_score(
    result: dict,
) -> float:
    """
    OCR이 해당 방향에서 글자를 얼마나 안정적으로
    인식했는지 점수화합니다.

    한글/영어/숫자를 모두 포함합니다.

    기준:
    1. 인식된 글자 수
    2. OCR confidence
    3. 글자가 가로 방향으로 인식되는 비율

    단순 글자 수만 비교하면
    돌아간 글자도 OCR이 읽어버릴 수 있기 때문에
    boundingPoly의 가로/세로 방향도 함께 사용합니다.
    """

    confidence_score = 0.0

    total_characters = 0
    horizontal_characters = 0

    for image in result.get("images", []):

        if image.get("inferResult") != "SUCCESS":
            continue

        for field in image.get("fields", []):

            text = field.get(
                "inferText",
                "",
            ).strip()

            if not text:
                continue

            # 한글, 영어, 숫자 모두 포함
            valid_characters = [
                char
                for char in text
                if char.isalnum()
            ]

            character_count = len(
                valid_characters
            )

            if character_count == 0:
                continue

            confidence = float(
                field.get(
                    "inferConfidence",
                    0.0,
                )
            )

            confidence_score += (
                character_count
                * confidence
            )

            total_characters += (
                character_count
            )

            vertices = (
                field
                .get("boundingPoly", {})
                .get("vertices", [])
            )

            if len(vertices) >= 4:

                xs = [
                    vertex.get("x", 0)
                    for vertex in vertices
                ]

                ys = [
                    vertex.get("y", 0)
                    for vertex in vertices
                ]

                width = max(xs) - min(xs)
                height = max(ys) - min(ys)

                # 일반적인 문서 글자는 가로가 더 긴 경우가 많음
                if width >= height:
                    horizontal_characters += (
                        character_count
                    )

    if total_characters == 0:
        return 0.0

    horizontal_ratio = (
        horizontal_characters
        / total_characters
    )

    # OCR 자체 성능 + 글자 방향
    score = (
        confidence_score
        * (
            0.25
            + 0.75 * horizontal_ratio
        )
    )

    return score


# =========================================================
# 이미지 전처리 + 자동 방향 보정
# =========================================================

def preprocess_image(
    image_path: str,
    lang: str = "ko",
) -> str:
    """
    문서 방향을 자동으로 판별하고 보정합니다.

    0°, 90°, 180°, 270° 후보에 대해
    일반 OCR을 실행한 뒤
    OCR 점수가 가장 높은 방향을 선택합니다.

    보정된 이미지는

        corrected_{원본파일명}.jpg

    형식으로 저장합니다.
    """

    path = Path(image_path)

    if not path.is_file():
        raise FileNotFoundError(
            f"파일을 찾을 수 없습니다: {path}"
        )

    image = cv2.imread(
        str(path)
    )

    if image is None:
        raise RuntimeError(
            f"이미지를 읽을 수 없습니다: {path}"
        )

    angles = [
        0,
        90,
        180,
        270,
    ]

    best_angle = None
    best_score = -1
    best_image = None

    with TemporaryDirectory() as temp_dir:

        temp_dir = Path(temp_dir)

        for angle in angles:

            rotated = rotate_image(
                image,
                angle,
            )

            temp_path = (
                temp_dir
                / f"rotation_{angle}.jpg"
            )

            success = cv2.imwrite(
                str(temp_path),
                rotated,
            )

            if not success:
                continue

            try:
                result = call_naver_ocr(
                    str(temp_path),
                    lang=lang,
                    table_detection=False,
                )

            except RuntimeError:
                # 특정 각도에서 OCR 실패 시
                # 다른 후보 계속 테스트
                continue

            score = calculate_ocr_score(
                result
            )

            if score > best_score:

                best_score = score
                best_angle = angle
                best_image = rotated

    if best_image is None:
        raise RuntimeError(
            "문서 방향을 자동으로 판단하지 못했습니다."
        )

    output_path = (
        path.parent
        / f"corrected_{path.stem}.jpg"
    )

    success = cv2.imwrite(
        str(output_path),
        best_image,
    )

    if not success:
        raise RuntimeError(
            f"보정 이미지 저장 실패: {output_path}"
        )

    print(
        f"자동 방향 보정 완료: {best_angle}°"
    )

    print(
        f"보정된 이미지 저장: {output_path}"
    )

    return str(output_path)


# =========================================================
# 일반 OCR 텍스트 추출
# =========================================================

def extract_text(
    result: dict,
    exclude_tables: bool = True,
) -> str:
    """
    일반 OCR 텍스트를 추출합니다.

    exclude_tables=True이면
    Table Detection으로 인식된 표 영역 안의 텍스트는 제외합니다.

    즉:
        표 내부 → tables
        표 외부 → text
    """

    lines = []

    for image in result.get("images", []):

        if image.get("inferResult") != "SUCCESS":
            continue

        # -------------------------------------------------
        # 표 영역 수집
        # -------------------------------------------------

        table_regions = []

        if exclude_tables:

            for table in image.get("tables", []):

                vertices = (
                    table
                    .get("boundingPoly", {})
                    .get("vertices", [])
                )

                if len(vertices) < 4:
                    continue

                xs = [
                    vertex.get("x", 0)
                    for vertex in vertices
                ]

                ys = [
                    vertex.get("y", 0)
                    for vertex in vertices
                ]

                table_regions.append(
                    {
                        "x1": min(xs),
                        "y1": min(ys),
                        "x2": max(xs),
                        "y2": max(ys),
                    }
                )

        current_line = []

        # -------------------------------------------------
        # 일반 OCR fields
        # -------------------------------------------------

        for field in image.get("fields", []):

            text = field.get(
                "inferText",
                "",
            ).strip()

            if not text:
                continue

            vertices = (
                field
                .get("boundingPoly", {})
                .get("vertices", [])
            )

            if len(vertices) < 4:
                continue

            xs = [
                vertex.get("x", 0)
                for vertex in vertices
            ]

            ys = [
                vertex.get("y", 0)
                for vertex in vertices
            ]

            x_center = (
                min(xs) + max(xs)
            ) / 2

            y_center = (
                min(ys) + max(ys)
            ) / 2

            # -------------------------------------------------
            # 표 안에 들어있는 텍스트인지 확인
            # -------------------------------------------------

            inside_table = False

            for region in table_regions:

                if (
                    region["x1"]
                    <= x_center
                    <= region["x2"]
                    and
                    region["y1"]
                    <= y_center
                    <= region["y2"]
                ):
                    inside_table = True
                    break

            if inside_table:
                continue

            # -------------------------------------------------
            # 표 밖 텍스트만 저장
            # -------------------------------------------------

            current_line.append(text)

            if (
                field.get("lineBreak")
                and current_line
            ):

                lines.append(
                    " ".join(current_line)
                )

                current_line = []

        if current_line:

            lines.append(
                " ".join(current_line)
            )

    return "\n".join(lines)

# =========================================================
# Table OCR 결과 추출
# =========================================================

def extract_tables(
    result: dict,
) -> list:
    """
    NAVER Table Detection 결과를
    컴퓨터가 읽기 쉬운 list/dict 형태로 반환합니다.

    반환 예시:

    [
        {
            "table_index": 1,
            "rows": [
                [
                    "검사항목",
                    "결과",
                    "참고치"
                ],
                [
                    "공복혈당",
                    "85",
                    "100미만"
                ]
            ]
        }
    ]

    빈 셀도 그대로 유지합니다.
    """

    extracted_tables = []

    for image in result.get(
        "images",
        [],
    ):

        if (
            image.get("inferResult")
            != "SUCCESS"
        ):
            continue

        tables = image.get(
            "tables",
            [],
        )

        for table_index, table in enumerate(
            tables,
            start=1,
        ):

            rows = {}

            for cell in table.get(
                "cells",
                [],
            ):

                row_index = cell.get(
                    "rowIndex",
                    0,
                )

                column_index = cell.get(
                    "columnIndex",
                    0,
                )

                cell_lines = []

                for line in cell.get(
                    "cellTextLines",
                    [],
                ):

                    line_words = []

                    for word in line.get(
                        "cellWords",
                        [],
                    ):

                        text = (
                            word
                            .get(
                                "inferText",
                                "",
                            )
                            .strip()
                        )

                        if text:
                            line_words.append(
                                text
                            )

                    if line_words:

                        cell_lines.append(
                            " ".join(
                                line_words
                            )
                        )

                # 셀 내부의 여러 줄은 공백으로 연결
                cell_text = " ".join(
                    cell_lines
                )

                rows.setdefault(
                    row_index,
                    {},
                )

                rows[row_index][
                    column_index
                ] = cell_text

            table_rows = []

            for row_index in sorted(
                rows.keys()
            ):

                columns = rows[
                    row_index
                ]

                if not columns:
                    continue

                max_column = max(
                    columns.keys()
                )

                row_values = [
                    columns.get(
                        column_index,
                        "",
                    )
                    for column_index
                    in range(
                        max_column + 1
                    )
                ]

                table_rows.append(
                    row_values
                )

            extracted_tables.append(
                {
                    "table_index":
                        table_index,

                    "rows":
                        table_rows,
                }
            )

    return extracted_tables


# =========================================================
# Table 출력 - 개발 확인용
# =========================================================

def print_tables(
    tables: list,
) -> None:
    """
    Table OCR 결과를 터미널에서
    사람이 보기 좋게 출력합니다.

    컴퓨터용 데이터에는 빈 셀을 유지하지만
    출력할 때만 빈 셀을 제거합니다.
    """

    if not tables:

        print(
            "표를 인식하지 못했습니다."
        )

        return

    for table in tables:

        print(
            f"===== TABLE "
            f"{table['table_index']} ====="
        )

        for row in table["rows"]:

            clean_row = [
                value
                for value in row
                if value.strip()
            ]

            if not clean_row:
                continue

            print(
                " | ".join(
                    clean_row
                )
            )

        print()


# =========================================================
# 최종 NAVER OCR
# =========================================================

def naver_ocr(
    image_path: str,
    lang: str = "ko",
) -> dict:
    """
    문서를 OCR합니다.

    반환 구조:

    {
        "tables": [...],
        "text": "..."
    }

    표가 있든 없든 일반 텍스트는 항상 보존합니다.

    - 표 형태 검사결과 → tables + text
    - 표가 없는 결과지 → text
    """

    # 먼저 Table Detection 활성화 상태로 OCR
    result = call_naver_ocr(
        image_path=image_path,
        lang=lang,
        table_detection=True,
    )

    tables = extract_tables(
        result
    )

    text = extract_text(
        result
    )

    # Table Detection 결과에서
    # 일반 fields가 충분히 나오지 않는 경우를 대비
    if not text.strip():

        normal_result = call_naver_ocr(
            image_path=image_path,
            lang=lang,
            table_detection=False,
        )

        text = extract_text(
            normal_result
        )

    if not tables and not text.strip():

        raise RuntimeError(
            "문서에서 표 또는 텍스트를 "
            "인식하지 못했습니다."
        )

    return {
        "tables": tables,
        "text": text,
    }


# =========================================================
# 테스트 실행
# =========================================================

if __name__ == "__main__":

    image_path = "sample6.jpg"

    # 1. 방향 자동 보정
    processed_image = preprocess_image(
        image_path
    )

    # 2. OCR
    result = naver_ocr(
        processed_image
    )

    # 3. 표 출력
    if result["tables"]:

        print_tables(
            result["tables"]
        )

    else:

        print(
            "===== TABLE ====="
        )

        print(
            "표를 인식하지 못했습니다."
        )

    # 4. 전체 텍스트 출력
    print(
        "===== TEXT ====="
    )

    print(
        result["text"]
    )