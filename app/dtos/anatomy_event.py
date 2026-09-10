from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AnatomyBodySide = Literal["left", "right", "midline", "bilateral", "unknown"]
AnatomyInputSource = Literal["tap", "brush", "depth", "dental", "search"]
AnatomyConfirmationState = Literal["surface_report", "geometric_candidate", "confirmed"]
AnatomyMappingStatus = Literal["canonical", "source_fallback", "unmapped"]


class AnatomyAtlasReference(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=100)
    version: str = Field(min_length=1, max_length=50)
    reference_sex: Literal["male", "female"] = Field(alias="referenceSex")
    topology_revision: str | None = Field(default=None, max_length=100, alias="topologyRevision")


class AnatomyConcept(BaseModel):
    model_config = ConfigDict(extra="ignore")

    canonical_concept_id: str = Field(min_length=1, max_length=150, alias="canonicalConceptId")
    source_key: str = Field(min_length=1, max_length=200, alias="sourceKey")
    source_mesh_id: str = Field(min_length=1, max_length=150, alias="sourceMeshId")
    label: str = Field(min_length=1, max_length=150)
    system: str = Field(min_length=1, max_length=50)
    side: AnatomyBodySide = "unknown"
    mapping_status: AnatomyMappingStatus = Field(default="canonical", alias="mappingStatus")


class AnatomyGeometry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    coordinate_space: Literal["world", "local"] = Field(default="world", alias="coordinateSpace")
    point: tuple[float, float, float]
    normal: tuple[float, float, float] | None = None
    face_index: int | None = Field(default=None, alias="faceIndex")
    uv: tuple[float, float] | None = None
    distance: float | None = None


class AnatomyBrushCoverage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    radius: float = Field(ge=0.0)
    sample_count: int = Field(ge=1, alias="sampleCount")
    hit_ratio: float | None = Field(default=None, ge=0.0, le=1.0, alias="hitRatio")


class AnatomyEvent(BaseModel):
    """3D 해부학 이벤트 표준 계약 DTO.

    클라이언트(Three.js/Vanatome)에서 발생한 해부학적 선택 이벤트를
    토폴로지 버전과 무관하게 안정적으로 표현하고 검증합니다.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    schema_version: Literal["1.0.0"] = Field(default="1.0.0", alias="schemaVersion")
    event_id: str = Field(min_length=1, max_length=100, alias="eventId")
    atlas: AnatomyAtlasReference
    concept: AnatomyConcept
    related_concepts: list[AnatomyConcept] = Field(default_factory=list, alias="relatedConcepts")
    geometry: AnatomyGeometry | None = None
    input_source: AnatomyInputSource = Field(default="tap", alias="inputSource")
    state: AnatomyConfirmationState = Field(default="confirmed")
    coverage: AnatomyBrushCoverage | None = None
    uncertainty: str | None = Field(default=None, max_length=500)
    recorded_at: datetime = Field(alias="recordedAt")
