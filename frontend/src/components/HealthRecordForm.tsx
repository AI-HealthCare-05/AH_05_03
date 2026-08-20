import { useMemo, useState, type FormEvent } from "react";
import { HealthRecordService } from "../local-domain/health-record-service";
import type { HealthPayload, LocalError } from "../local-domain/types";

type Category = "metric" | "care" | "lifestyle" | "other";
interface ProfileOption { id: string; name: string; relationship: string }
interface Props { householdId: string; profiles: ProfileOption[] }

const today = new Date().toISOString().slice(0, 10);
const number = (value: FormDataEntryValue | null) => value === null || value === "" ? undefined : Number(value);
const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const atLocalNoon = (date: string) => new Date(`${date}T12:00:00`).toISOString();

function payloadFromForm(category: Category, data: FormData): HealthPayload {
  const subtype = text(data, "subtype");
  const note = text(data, "note") || undefined;
  if (category === "metric" && subtype === "blood_pressure") return { type: "blood_pressure", systolicMmHg: Number(data.get("systolic")), diastolicMmHg: Number(data.get("diastolic")), pulseBpm: number(data.get("pulse")), note };
  if (category === "metric" && subtype === "blood_glucose") return { type: "blood_glucose", valueMgDl: Number(data.get("glucose")), timing: text(data, "timing") as "fasting", minutesAfterMeal: number(data.get("minutesAfterMeal")), note };
  if (category === "metric" && subtype === "body_measurement") return { type: "body_measurement", heightCm: number(data.get("height")), weightKg: number(data.get("weight")), bodyFatPercent: number(data.get("bodyFat")), skeletalMuscleKg: number(data.get("muscle")), waistCm: number(data.get("waist")), note };
  if (category === "metric") return { type: "lab_result", testCode: text(data, "testCode") || "manual", testName: text(data, "testName"), value: text(data, "labValue"), unit: text(data, "unit") || undefined, note };
  if (category === "care" && subtype === "vaccination") return { type: "vaccination", vaccineName: text(data, "name"), doseNumber: number(data.get("dose")), institution: text(data, "institution") || undefined, note };
  if (category === "care") return { type: "health_screening", screeningName: text(data, "name"), institution: text(data, "institution") || undefined, summary: note };
  if (category === "lifestyle") return { type: "walking", steps: number(data.get("steps")), distanceKm: number(data.get("distance")), durationMinutes: number(data.get("duration")), sourceName: text(data, "sourceName") || undefined, note };
  return { type: "note", title: text(data, "name") || undefined, text: text(data, "note") };
}

const categories: Array<[Category, string, string]> = [
  ["metric", "수치형 건강 지표", "혈압·혈당·체성분·검사 수치"],
  ["care", "예방접종·검진", "접종과 종합검진 이력"],
  ["lifestyle", "생활 기록", "걸음 수·거리·시간"],
  ["other", "전문 검사·기타", "검사 또는 관찰 요약"],
];

export function HealthRecordForm({ householdId, profiles }: Props) {
  const service = useMemo(() => new HealthRecordService(), []);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [category, setCategory] = useState<Category>("metric");
  const [subtype, setSubtype] = useState("blood_pressure");
  const [error, setError] = useState<LocalError | null>(null);
  const [pending, setPending] = useState<FormData | null>(null);
  const [saved, setSaved] = useState<{ title: string; date: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const changeCategory = (next: Category) => {
    setCategory(next);
    setSubtype(next === "metric" ? "blood_pressure" : next === "care" ? "vaccination" : next === "lifestyle" ? "walking" : "note");
    setError(null);
  };

  const save = async (data: FormData, duplicatePolicy: "reject" | "allow") => {
    setSaving(true); setError(null);
    const date = text(data, "date");
    if (!date) {
      setSaving(false);
      setError({ code: "VALIDATION_ERROR", message: "기록일을 입력해 주세요.", fieldErrors: [{ field: "date", reason: "기록일은 필수입니다." }], retryable: false });
      return;
    }
    const result = await service.create({ householdId, profileId, recordedAt: atLocalNoon(date), source: "manual", payload: payloadFromForm(category, data), duplicatePolicy });
    setSaving(false);
    if (!result.ok) {
      if (result.error.code === "DUPLICATE_RECORD") setPending(data);
      else setError(result.error);
      return;
    }
    setPending(null);
    setSaved({ title: categories.find(([id]) => id === category)![1], date: text(data, "date") });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(new FormData(event.currentTarget), "reject"); };
  const fieldError = (field: string) => error?.fieldErrors?.find((item) => item.field === field)?.reason;

  return <main className="page-shell">
    <header className="page-header"><button className="back" type="button">← 건강 이력</button><div><p className="eyebrow">로컬 건강 기록</p><h1>건강기록 작성</h1><p>가족의 기록을 직접 입력하고 이 브라우저에 안전하게 보관하세요.</p></div></header>
    {saved && <section className="success" role="status"><strong>기록을 저장했어요.</strong><span>{saved.title} · {saved.date}</span><button onClick={() => setSaved(null)}>새 기록 작성</button></section>}
    {!saved && <form onSubmit={onSubmit} noValidate>
      <section className="section"><div className="section-heading"><span>1</span><div><h2>기록 대상</h2><p>누구의 건강 기록인지 선택해 주세요.</p></div></div><div className="profile-list">{profiles.map((profile) => <button type="button" key={profile.id} className={profile.id === profileId ? "profile active" : "profile"} onClick={() => setProfileId(profile.id)}><span className="avatar">{profile.name.slice(-1)}</span><span><strong>{profile.name}</strong><small>{profile.relationship}</small></span></button>)}</div></section>
      <section className="section"><div className="section-heading"><span>2</span><div><h2>기록 유형</h2><p>선택한 유형에 맞는 항목만 보여드려요.</p></div></div><div className="category-grid">{categories.map(([id, label, help]) => <button type="button" key={id} className={id === category ? "category active" : "category"} onClick={() => changeCategory(id)}><i>{id === "metric" ? "↗" : id === "care" ? "+" : id === "lifestyle" ? "◷" : "□"}</i><strong>{label}</strong><small>{help}</small></button>)}</div></section>
      <section className="section form-section"><div className="section-heading"><span>3</span><div><h2>상세 정보</h2><p>의료적 판정 없이 입력한 사실만 저장합니다.</p></div></div><div className="form-grid"><label>기록일<input name="date" type="date" defaultValue={today} required /></label>{category === "metric" && <><label>지표 항목<select name="subtype" value={subtype} onChange={(e) => setSubtype(e.target.value)}><option value="blood_pressure">혈압</option><option value="blood_glucose">혈당</option><option value="body_measurement">체성분</option><option value="lab_result">간수치·기타 검사</option></select></label>{subtype === "blood_pressure" && <><label>수축기 혈압<input name="systolic" type="number" placeholder="예: 120" /><em>mmHg</em>{fieldError("systolicMmHg") && <b>{fieldError("systolicMmHg")}</b>}</label><label>이완기 혈압<input name="diastolic" type="number" placeholder="예: 80" /><em>mmHg</em>{fieldError("diastolicMmHg") && <b>{fieldError("diastolicMmHg")}</b>}</label><label>맥박 (선택)<input name="pulse" type="number" placeholder="예: 72" /><em>bpm</em></label></>}{subtype === "blood_glucose" && <><label>혈당<input name="glucose" type="number" /><em>mg/dL</em>{fieldError("valueMgDl") && <b>{fieldError("valueMgDl")}</b>}</label><label>측정 시점<select name="timing"><option value="fasting">공복</option><option value="before_meal">식전</option><option value="after_meal">식후</option><option value="bedtime">취침 전</option><option value="random">무작위</option></select></label><label>식후 경과 시간 (선택)<input name="minutesAfterMeal" type="number" /><em>분</em></label></>}{subtype === "body_measurement" && <><label>키<input name="height" type="number" step="0.1" /><em>cm</em></label><label>체중<input name="weight" type="number" step="0.1" /><em>kg</em></label><label>체지방률<input name="bodyFat" type="number" step="0.1" /><em>%</em></label><label>골격근량<input name="muscle" type="number" step="0.1" /><em>kg</em></label><label>허리둘레<input name="waist" type="number" step="0.1" /><em>cm</em></label></>}{subtype === "lab_result" && <><label>검사명<input name="testName" placeholder="예: AST(GOT)" />{fieldError("testName") && <b>{fieldError("testName")}</b>}</label><label>검사값<input name="labValue" /></label><label>단위<input name="unit" placeholder="예: U/L" /></label></>}</>}{category === "care" && <><label>구분<select name="subtype" value={subtype} onChange={(e) => setSubtype(e.target.value)}><option value="vaccination">예방접종</option><option value="health_screening">종합검진</option></select></label><label>{subtype === "vaccination" ? "접종명" : "검진명"}<input name="name" placeholder={subtype === "vaccination" ? "예: 독감 예방접종" : "예: 국가건강검진"} />{fieldError(subtype === "vaccination" ? "vaccineName" : "screeningName") && <b>{fieldError(subtype === "vaccination" ? "vaccineName" : "screeningName")}</b>}</label>{subtype === "vaccination" && <label>접종 차수<input name="dose" type="number" min="1" max="20" placeholder="예: 2" /></label>}<label>의료기관 (선택)<input name="institution" /></label></>}{category === "lifestyle" && <><input type="hidden" name="subtype" value="walking" /><label>걸음 수<input name="steps" type="number" /><em>걸음</em></label><label>이동 거리<input name="distance" type="number" step="0.01" /><em>km</em></label><label>걷기 시간<input name="duration" type="number" /><em>분</em></label><label>기록 출처 (선택)<input name="sourceName" placeholder="예: 직접 입력" /></label>{fieldError("walking") && <p className="wide-error">{fieldError("walking")}</p>}</>}{category === "other" && <><input type="hidden" name="subtype" value="note" /><label>검사·기록명<input name="name" placeholder="예: 골절 X-ray" /></label></>}<label className="full">{category === "care" ? "결과 요약 또는 특이사항" : category === "other" ? "결과 요약" : "참고 메모"}<textarea name="note" rows={4} placeholder="사용자가 직접 확인한 내용만 입력해 주세요." />{fieldError("text") && <b>{fieldError("text")}</b>}</label></div><div className="notice"><span>ⓘ</span><p><strong>로컬 저장 안내</strong>작성한 기록은 이 브라우저에만 암호화되어 저장됩니다. 서버 전송이나 의료적 해석은 하지 않습니다.</p></div></section>
      {error && <div className="form-error" role="alert">{error.message}</div>}
      <footer className="actions"><button type="button" className="secondary">취소</button><button disabled={saving || !profileId} className="primary">{saving ? "저장 중…" : "기록 저장"}</button></footer>
    </form>}
    {pending && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-title"><span className="modal-icon">!</span><h2 id="duplicate-title">동일한 기록이 이미 있어요</h2><p>같은 구성원·날짜에 내용이 동일한 기록이 있습니다. 그래도 새 기록으로 저장할까요?</p><div><button className="secondary" onClick={() => setPending(null)}>돌아가기</button><button className="danger" onClick={() => void save(pending, "allow")}>새 기록으로 저장</button></div></section></div>}
  </main>;
}
