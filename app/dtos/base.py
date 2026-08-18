from pydantic import BaseModel, ConfigDict


class BaseSerializerModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BaseRequestModel(BaseModel):
    """extra="forbid"가 서버 경계를 강제한다.

    구버전 클라이언트가 name/gender/birth_date/phone_number를 여전히 보내면
    조용히 버리는 대신 422로 거부한다. docs/03_api_spec.md 2절과
    docs/05_tech_architecture.md 4절의 금지 항목을 API 경계에서 실제로 지킨다.
    """

    model_config = ConfigDict(extra="forbid")
