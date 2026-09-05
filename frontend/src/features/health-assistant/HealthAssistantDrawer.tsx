import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from "react";
import type { FamilyProfile, HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
// PR 은 전용 `DevServerOcrAdapter` 를 썼는데, project 에는 같은 응답을 큐·스트리밍으로
// 받는 `GeminiOcrAdapter` 가 이미 있다(`text`·`tables` 가 같은 모양이고 `measurements`
// 가 더 붙는다). 어댑터를 둘 두면 인식 경로가 갈라지므로 있는 쪽으로 모은다.
import { GeminiOcrAdapter } from "../../shared/api/geminiOcrAdapter";

import {
  streamHealthAssistantMessage,
  createChatSession,
  listChatSessions,
  listChatMessages,
  type HealthAssistantResponse,
  type ExerciseDraft,
  type BloodPressureDraft,
  type BloodGlucoseDraft,
  type MedicationDraft,
  type PainDraft,
  type LabResultDraft,
  type ChallengeDraft,
} from "./healthAssistantClient";
import { selectContextRecordTypes } from "./healthAssistantContext";
import {
  containsNewMedicationRecord,
  detectMetricKeyFromQuery,
  extractMetricsFromRecords,
  filterRecordsByTimeRange,
  formatTargetDateTime,
  isValidContentKeyword,
  type MetricSeries,
  normalizeRecordTypes,
  parseExamDateFromText,
  resolveHealthRecordDateTime,
  resolveMedicationTakenAt,
  shouldAutoSaveHealthRecord,
  type ExtendedChatMessage,
  type OcrReviewItem,
  PRIMARY_HOUSEHOLD_ID,
  buildAutoSaveAssistantMessage,
  extractReviewItems,
  normalizeBloodGlucoseTiming,
  removeMedicationSavePrompt,
  reviewItemsToText,
  loadChatSession,
  saveChatSession,
  clearChatSession,
  createWelcomeMessage,
  mergeServerMessagesWithLocalUi,
} from "./healthAssistantLogic";
import "./healthAssistantDrawer.css";

/**
 * 대화 메시지 id.
 *
 * `Date.now()` 를 컴포넌트 안에서 직접 부르면 리액트 컴파일러 규칙이 **렌더 단계의
 * 불순 호출**로 잡는다(이벤트 핸들러 안이어도 컴포넌트 본문 스코프다). 모듈 수준
 * 함수로 빼면 그 판정에서 벗어나고, 부르는 쪽도 무엇을 만드는지가 이름으로 보인다.
 */
function messageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface HealthAssistantDrawerProps {
  profile?: FamilyProfile;
  runtime?: LocalDomainRuntime;
  isOpen: boolean;
  onClose: () => void;
  onRecordSaved?: () => Promise<void> | void;
  onChallengeSaved?: () => Promise<void> | void;
  onNavigateToRecords?: () => void;
}

export function HealthAssistantDrawer({
  profile,
  runtime,
  isOpen,
  onClose,
  onRecordSaved,
  onNavigateToRecords,
}: HealthAssistantDrawerProps) {
  // 초기 메시지는 이전 세션이 있으면 복원하고, 없으면 환영 메시지로 시작한다.
  const [messages, setMessages] = useState<ExtendedChatMessage[]>(() => {
    if (!profile) return [];
    const saved = loadChatSession(profile.id);
    return saved && saved.length > 0 ? saved : [createWelcomeMessage(profile.displayName)];
  });
  const messagesRef = useRef(messages);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionSyncPromiseRef = useRef<Promise<string | null> | null>(null);
  const skipNextCacheWriteRef = useRef(false);
  const activeProfileIdRef = useRef<string | null>(profile?.id ?? null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sourcePreviewModal, setSourcePreviewModal] = useState<{ url: string; name: string } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInitialScrollRef = useRef(true);

  // 건강 서류 상세 검토 및 저장 모달 상태
  const [ocrModalOpen, setOcrModalOpen] = useState(false);
  const [ocrModalWorking, setOcrModalWorking] = useState(false);
  const [ocrReviewDraft, setOcrReviewDraft] = useState<LabResultDraft | null>(null);
  const [ocrReviewItems, setOcrReviewItems] = useState<OcrReviewItem[]>([]);
  const [ocrModalError, setOcrModalError] = useState<string>();
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null);
  const [ocrImagePreviewUrl, setOcrImagePreviewUrl] = useState<string | null>(null);

  // 질문에 직접 필요한 종류의 최근 기록만 AI 컨텍스트로 구성한다.
  async function fetchRecentRecordsSummary(recordTypes: HealthRecordType[]): Promise<string | undefined> {
    if (!runtime || !profile || recordTypes.length === 0) return undefined;
    try {
      const qRes = await runtime.healthRecords.query({
        profileId: profile.id,
        recordTypes,
        includeDeleted: false,
      });
      if (!qRes.ok || qRes.value.length === 0) return undefined;

      const recent = [...qRes.value]
        .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
        .slice(0, 5);

      const summaryList = recent.map((r) => {
        const p = r.payload as Record<string, unknown>;
        const dateStr = r.recordedAt.slice(0, 10);
        if (r.recordType === "medication" || p.medicationName) {
          return `[${dateStr} 복약] ${p.medicationName} ${p.dosage ?? ""} (${p.takenAt ?? ""})`;
        }
        if (r.recordType === "blood_pressure" || p.systolicMmHg) {
          return `[${dateStr} 혈압] ${p.systolicMmHg}/${p.diastolicMmHg} mmHg (맥박 ${p.pulseBpm ?? "-"})`;
        }
        if (r.recordType === "exercise" || p.exerciseName) {
          return `[${dateStr} 운동] ${p.exerciseName} ${p.weightKg ? `${p.weightKg}kg ` : ""}${p.reps ? `${p.reps}회 ` : ""}${p.sets ? `${p.sets}세트` : ""}`;
        }
        if (r.recordType === "pain" || p.bodyArea) {
          return `[${dateStr} 통증] ${p.bodyArea} 강도 ${p.intensity}/10`;
        }
        if (r.recordType === "health_screening" || r.recordType === "lab_result") {
          return `[${dateStr} 검진/검사] ${p.screeningName ?? p.testName ?? ""} ${p.note ?? p.summary ?? ""}`.slice(0, 100);
        }
        return `[${dateStr} ${r.recordType}] ${p.note ?? ""}`;
      });

      return summaryList.join("; ");
    } catch {
      return undefined;
    }
  }

  // 인사말은 초기 상태에서 만든다(위 `useState` 참조). effect 로 넣으면 첫 렌더 뒤
  // 한 번 더 그리게 되고 그 사이 한 프레임 동안 빈 대화가 보인다.

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const doScroll = () => {
      if (messagesContainerRef.current) {
        if (typeof messagesContainerRef.current.scrollTo === "function") {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior,
          });
        } else {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      } else if (typeof messagesEndRef.current?.scrollIntoView === "function") {
        messagesEndRef.current.scrollIntoView({ behavior });
      }
    };

    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 60);
    setTimeout(doScroll, 260);
  };

  // 서랍을 열거나 재진입할 때, 이전 대화 목록이 복원되면 사용자가 마지막으로 나눈 대화(최하단)를 즉시 보여준다.
  useEffect(() => {
    if (!isOpen) {
      isInitialScrollRef.current = true;
      return;
    }

    if (isInitialScrollRef.current) {
      isInitialScrollRef.current = false;
      scrollToBottom("auto");
    } else {
      scrollToBottom("smooth");
    }
  }, [messages, loading, isOpen]);

  // 구성원이 바뀌거나 서랍이 열리면 해당 구성원의 대화 세션을 복원한다.
  // 1. 빠른 화면 렌더를 위해 sessionStorage 캐시를 우선 즉시 표시한다.
  // 2. 단일 진실 원천인 PostgreSQL 서버에서 해당 프로필의 대화 세션과 메시지 목록을 가져와 동기화한다.
  // 프로필 전환 시 빠른 클릭으로 인한 응답 역전(레이스 컨디션)은 activeProfileIdRef 로 차단한다.
  useEffect(() => {
    if (!profile || !isOpen) return;
    const currentProfileId = profile.id;
    const profileDisplayName = profile.displayName;
    activeProfileIdRef.current = currentProfileId;
    // 새 프로필의 세션을 찾는 동안 이전 프로필의 세션 id를 재사용하지 않는다.
    activeSessionIdRef.current = null;
    skipNextCacheWriteRef.current = true;

    const saved = loadChatSession(currentProfileId);
    setMessages(saved && saved.length > 0 ? saved : [createWelcomeMessage(profileDisplayName)]);
    setSelectedImage(null);
    setImagePreview(null);

    let isSubscribed = true;

    async function syncSession(): Promise<string | null> {
      try {
        const sessions = await listChatSessions(currentProfileId);
        if (!isSubscribed || activeProfileIdRef.current !== currentProfileId) return null;

        if (sessions.length > 0) {
          const latest = sessions[0];
          activeSessionIdRef.current = latest.id;
          const dbMessages = await listChatMessages(latest.id);
          if (!isSubscribed || activeProfileIdRef.current !== currentProfileId) return null;

          if (dbMessages.length > 0) {
            const currentLocal =
              messagesRef.current.length > 0
                ? messagesRef.current
                : (loadChatSession(currentProfileId) ?? saved);
            const mapped = mergeServerMessagesWithLocalUi(dbMessages, currentLocal);
            setMessages(mapped);
            saveChatSession(currentProfileId, mapped);
          } else {
            setMessages([createWelcomeMessage(profileDisplayName)]);
          }
          return latest.id;
        } else {
          const newSession = await createChatSession(currentProfileId);
          if (!isSubscribed || activeProfileIdRef.current !== currentProfileId) return null;
          activeSessionIdRef.current = newSession.id;
          setMessages([createWelcomeMessage(profileDisplayName)]);
          clearChatSession(currentProfileId);
          return newSession.id;
        }
      } catch (err) {
        console.warn("대화 세션 서버 동기화 실패 (오프라인 캐시 유지):", err);
        return null;
      }
    }

    sessionSyncPromiseRef.current = syncSession();

    return () => {
      isSubscribed = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.displayName, isOpen]);

  // 대화가 갱신되면 현재 구성원의 임시 세션 저장소에 자동 캐싱한다 (화면 복구 및 오프라인용).
  useEffect(() => {
    messagesRef.current = messages;
    if (!profile || messages.length === 0) return;
    // 프로필이 바뀐 그 렌더에는 아직 직전 프로필의 messages가 남아 있다.
    // 그 값을 새 프로필의 캐시에 쓰지 않고, setMessages 이후 렌더부터 저장한다.
    if (skipNextCacheWriteRef.current) {
      skipNextCacheWriteRef.current = false;
      return;
    }
    saveChatSession(profile.id, messages);
  }, [profile, messages]);

  // 대화 비우기 및 새 대화 시작 (PostgreSQL 서버에 새 세션 생성)
  async function handleClearChat() {
    if (!profile) return;
    clearChatSession(profile.id);
    setMessages([createWelcomeMessage(profile.displayName)]);
    setSelectedImage(null);
    setImagePreview(null);

    try {
      const newSession = await createChatSession(profile.id);
      activeSessionIdRef.current = newSession.id;
    } catch (err) {
      console.warn("새 대화 세션 생성 실패:", err);
    }
  }

  // 이미지 미리보기 메모리 정리
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      if (sourcePreviewModal) URL.revokeObjectURL(sourcePreviewModal.url);
    };
  }, [imagePreview, sourcePreviewModal]);


  if (!isOpen || !profile) return null;

  // 이미지 파일 선택 핸들러 (+ 버튼 클릭 시 OCR 모달 즉시 실행)
  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일(JPG, PNG, WEBP)만 업로드할 수 있습니다.");
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    const previewUrl = URL.createObjectURL(file);
    setSelectedImage(file);
    setImagePreview(previewUrl);
    setError(undefined);

    // 모달을 열고 서류 분석 시작
    setOcrImageFile(file);
    setOcrImagePreviewUrl(previewUrl);
    setOcrModalOpen(true);
    setOcrModalWorking(true);
    setOcrReviewDraft(null);
    setOcrReviewItems([]);
    setOcrModalError(undefined);

    try {
      const ocrAdapter = new GeminiOcrAdapter();
      const ocrResult = await ocrAdapter.recognize(file, file.name);
      const items = extractReviewItems(ocrResult.tables);
      const structuredText = reviewItemsToText(items);
      const extractedText = ocrResult.text.trim() || structuredText;
      if (!extractedText) throw new Error("서류에서 확인할 수 있는 글자나 검사 항목을 찾지 못했습니다. 더 선명한 이미지를 선택해 주세요.");
      const extractedDate = parseExamDateFromText(extractedText) || new Date().toISOString().slice(0, 10);

      const draft: LabResultDraft = {
        screening_name: "건강검진",
        recorded_at: extractedDate,
        summary: extractedText.slice(0, 300),
        items_summary: extractedText,
      };
      setOcrReviewItems(items);
      setOcrReviewDraft(draft);
    } catch (ocrErr) {
      console.warn("서류 분석 오류:", ocrErr);
      setOcrModalError(ocrErr instanceof Error ? ocrErr.message : "서류 분석에 실패했습니다.");
    } finally {
      setOcrModalWorking(false);
    }
  }

  function clearSelectedImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 모달에서 서류 확정 저장 핸들러
  async function handleConfirmOcrModalSave(draft: LabResultDraft, items: OcrReviewItem[]) {
    if (!runtime || !profile || !ocrImageFile) return;
    setOcrModalWorking(true);
    try {
      let primaryDocumentId: string | undefined;
      if (runtime.documents) {
        const savedDoc = await runtime.documents.save({
          householdId: PRIMARY_HOUSEHOLD_ID,
          profileId: profile.id,
          file: ocrImageFile,
          fileName: ocrImageFile.name,
        });
        if (!savedDoc.ok) throw new Error(savedDoc.error.message);
        primaryDocumentId = savedDoc.value.id;
      }

      const finalNote = [
        draft.summary ? `[검진 요약]\n${draft.summary}` : "",
        draft.items_summary ? `[검사 항목 및 결과]\n${draft.items_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const recResult = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "health_screening",
        recordedAt: draft.recorded_at ? new Date(draft.recorded_at).toISOString() : new Date().toISOString(),
        source: "ocr",
        sourceDocumentId: primaryDocumentId,
        payload: {
          type: "health_screening",
          screeningName: draft.screening_name || "건강검진",
          institution: draft.institution ?? undefined,
          summary: draft.summary ?? "",
          itemsSummary: draft.items_summary ?? "",
          items,
          note: finalNote || draft.summary || "건강검진 결과",
        },
      });

      if (!recResult.ok) throw new Error(recResult.error.message);

      // 대화창에 사용자 메시지와 어시스턴트 완료 메시지 추가
      const userMsg: ExtendedChatMessage = {
        id: messageId("user"),
        role: "user",
        content: `검사 서류(${ocrImageFile.name})를 업로드하여 기록했습니다.`,
        imageBlobUrl: ocrImagePreviewUrl ?? undefined,
        imageFile: ocrImageFile,
      };

      const assistantMsg: ExtendedChatMessage = {
        id: messageId("assistant"),
        role: "assistant",
        content: `${draft.recorded_at}에 실시된 ${draft.screening_name || "건강검진"} 결과가 나의 건강기록에 안전하게 저장되었습니다. 원본 서류는 언제든 확인하실 수 있습니다.`,
        attachedDocuments: primaryDocumentId ? [{
          id: primaryDocumentId,
          fileName: ocrImageFile.name,
        }] : undefined,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setOcrModalOpen(false);
      clearSelectedImage();

      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록 저장에 실패했습니다.");
    } finally {
      setOcrModalWorking(false);
    }
  }

  async function handleSend(contentToSend?: string) {
    const textToSend = (contentToSend ?? input).trim();
    const currentImage = selectedImage;
    const currentImagePreview = imagePreview;

    if ((!textToSend && !currentImage) || loading || !profile) return;

    clearSelectedImage();

    let userContent = textToSend;
    let ocrAttachedText = "";
    let extractedExamDate: string | undefined;

    // 이미지가 첨부된 경우 OCR 실행 및 날짜 추출
    if (currentImage) {
      setLoading(true);
      setError(undefined);
      try {
        const ocrAdapter = new GeminiOcrAdapter();
        const ocrResult = await ocrAdapter.recognize(currentImage, currentImage.name);
        ocrAttachedText = ocrResult.text;
        extractedExamDate = parseExamDateFromText(ocrResult.text);

        if (!userContent) {
          userContent = "건강검진표/검사결과지 서류 이미지를 업로드했습니다. 내용을 확인하고 기록해 주세요.";
        }
      } catch (ocrErr) {
        console.warn("서류 분석 실행 오류:", ocrErr);
        if (!userContent) {
          userContent = "서류 이미지를 업로드했습니다.";
        }
      }
    }

    const userMsg: ExtendedChatMessage = {
      id: messageId("user"),
      role: "user",
      content: userContent,
      imageBlobUrl: currentImagePreview ?? undefined,
      imageFile: currentImage ?? undefined,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(undefined);

    try {
      // 일반 대화/기록 입력에는 과거 건강정보를 보내지 않는다.
      // 개인 기록이 실제로 필요한 건강 질문에 한해 관련 종류만 선별한다.
      const recentConversationText = nextMessages
        .slice(-6)
        .map((message) => message.content)
        .join("\n");
      const contextRecordTypes = selectContextRecordTypes(recentConversationText);
      const recentSummary = await fetchRecentRecordsSummary(contextRecordTypes);

      // AI 전송용 메시지 배열 구성 (OCR 텍스트가 있으면 함께 포함)
      const promptMessages = nextMessages.slice(-12).map((m, idx, recentMessages) => {
        if (idx === recentMessages.length - 1 && ocrAttachedText) {
          return {
            role: m.role,
            content: `${m.content}\n\n[업로드된 검사 서류 추출 내용]\n${ocrAttachedText}`,
          };
        }
        return { role: m.role, content: m.content };
      });

      // 대화 API 를 **스트리밍으로** 부른다.
      //
      // 빈 답변 거품을 먼저 세우고 글자가 오는 대로 채운다. 예전에는 응답이 다 올
      // 때까지(느리면 15초) 점 세 개만 돌았다 — 기다리는 동안 아무 일도 일어나지
      // 않는 것처럼 보인다. 기록 초안·빠른답장은 완성본이 온 뒤에 한 번에 붙는다.
      const streamingId = messageId("assistant");
      let streamed = "";
      setMessages((prev) => [...prev, { id: streamingId, role: "assistant", content: "" }]);
      let sessionId = activeSessionIdRef.current;
      if (!sessionId && sessionSyncPromiseRef.current) {
        sessionId = await sessionSyncPromiseRef.current;
      }
      // 초기 동기화가 실패했더라도 온라인 요청이 가능한 시점이면 세션을 다시 만든다.
      if (!sessionId && activeProfileIdRef.current === profile.id) {
        try {
          const newSession = await createChatSession(profile.id);
          sessionId = newSession.id;
          activeSessionIdRef.current = sessionId;
        } catch (sessionError) {
          // 세션 저장 장애가 기존 챗봇 자체를 막아서는 안 된다. 대화는 계속하고
          // sessionStorage 캐시로 복구하며 다음 요청에서 다시 서버 세션을 시도한다.
          console.warn("대화 세션 생성 실패 (로컬 캐시로 계속):", sessionError);
        }
      }

      const res = sessionId
        ? await streamHealthAssistantMessage(
            promptMessages,
            (delta) => {
              streamed += delta;
              setMessages((prev) => prev.map((m) => (m.id === streamingId ? { ...m, content: streamed } : m)));
            },
            {
              profile_name: profile.displayName,
              relationship: profile.relationship,
              birth_year: profile.birthDate ? parseInt(profile.birthDate.slice(0, 4), 10) : undefined,
              recent_records_summary: recentSummary,
            },
            undefined,
            sessionId,
          )
        : await streamHealthAssistantMessage(
            promptMessages,
            (delta) => {
              streamed += delta;
              setMessages((prev) => prev.map((m) => (m.id === streamingId ? { ...m, content: streamed } : m)));
            },
            {
              profile_name: profile.displayName,
              relationship: profile.relationship,
              birth_year: profile.birthDate ? parseInt(profile.birthDate.slice(0, 4), 10) : undefined,
              recent_records_summary: recentSummary,
            },
          );


      // OCR에서 추출된 날짜가 있고 AI가 날짜를 채우지 않았거나 오늘로 채운 경우 보정
      if (res.lab_result_draft && extractedExamDate && (!res.lab_result_draft.recorded_at || res.lab_result_draft.recorded_at === new Date().toISOString().slice(0, 10))) {
        res.lab_result_draft.recorded_at = extractedExamDate;
      }
      if (res.medication_draft && containsNewMedicationRecord(textToSend)) {
        res.medication_draft.taken_at = resolveMedicationTakenAt(
          textToSend,
          res.medication_draft.taken_at,
        );
      } else if (res.medication_draft) {
        // 최근 복약 기록은 답변 근거일 뿐, 현재 사용자가 새 복약 사실을 말하지 않았다면
        // 다시 저장할 초안으로 취급하지 않는다.
        res.medication_draft = null;
        const hasAnotherDraft = Boolean(
          res.exercise_draft ||
          res.blood_pressure_draft ||
          res.blood_glucose_draft ||
          res.pain_draft ||
          res.lab_result_draft,
        );
        if (!hasAnotherDraft) {
          res.needs_confirmation = false;
          res.missing_fields = [];
        }
        res.assistant_message = removeMedicationSavePrompt(res.assistant_message);
        res.suggested_quick_replies = res.suggested_quick_replies.filter(
          (reply) => !/(?:기록|저장)/.test(reply),
        );
      }

      if (res.exercise_draft) {
        res.exercise_draft.date_str = resolveHealthRecordDateTime(
          textToSend,
          res.exercise_draft.date_str,
        );
      }
      if (res.blood_pressure_draft) {
        res.blood_pressure_draft.measured_at = resolveHealthRecordDateTime(
          textToSend,
          res.blood_pressure_draft.measured_at,
        );
      }
      if (res.blood_glucose_draft) {
        res.blood_glucose_draft.measured_at = resolveHealthRecordDateTime(
          textToSend,
          res.blood_glucose_draft.measured_at,
        );
      }
      if (res.pain_draft) {
        res.pain_draft.onset_at = resolveHealthRecordDateTime(
          textToSend,
          res.pain_draft.onset_at,
        );
      }

      const assistantMsgId = messageId("assistant");
      const shouldAutoSave = shouldAutoSaveHealthRecord(res, textToSend);
      if (shouldAutoSave) {
        res.auto_save = true;
        res.needs_confirmation = false;
        res.missing_fields = [];
        res.suggested_quick_replies = res.suggested_quick_replies.filter(
          (reply) => !/(?:저장|기록|수정|취소)/.test(reply),
        );
        res.assistant_message = buildAutoSaveAssistantMessage(res);
      }
      const assistantMsg: ExtendedChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: res.assistant_message,
        responseDraft: res,
        imageFile: currentImage ?? undefined,
      };

      setMessages((prev) => {
        const hasStreaming = prev.some((m) => m.id === streamingId);
        if (hasStreaming) {
          return prev.map((m) => (m.id === streamingId ? assistantMsg : m));
        }
        return [...prev, assistantMsg];
      });

      if (shouldAutoSave) {
        const saved = await saveStructuredDraftAutomatically(res, assistantMsgId);
        if (!saved) {
          setMessages((prev) => prev.map((message) => message.id === assistantMsgId
            ? { ...message, content: "입력하신 기록은 이해했지만 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }
            : message));
        }
      }

      // 챌린지 인텐트는 **여기서 실행하지 않는다.**
      //
      // PR 원본은 주차별 계획 모델(`runtime.challenges` — 활성 계획·과제·휴식일)을
      // 전제로 `adjust_challenge`·`complete_challenge` 를 자동 처리했다. project 의
      // 챌린지는 그 모델이 아니다 — 서버가 도는 **일일 체크**(`/challenges/today` ·
      // `/challenges/checks` · `/challenges/garden`)이고 "계획"·"과제 분"·"휴식일"
      // 이라는 개념 자체가 없다.
      //
      // 없는 개념에 억지로 매핑하면 대화로 바꾼 것과 챌린지 화면이 보여 주는 것이
      // 어긋난다. 모델을 맞추기 전까지 비서는 말로 안내하고, 실제 변경은 챌린지
      // 화면에서 한다.

      // 조회 질의이거나 질문인 경우 IndexedDB에서 데이터 조회 수행
      const isExplicitDocRequest =
        /(?:원본|서류|사진|스캔|문서|이미지)/.test(textToSend) ||
        /(?:원본|서류|서류함).*(?:확인|보여|아래)/.test(res.assistant_message);
      const isTrendRequest =
        /(?:그래프|변화\s*추이|추이|트렌드)/.test(textToSend) ||
        /(?:검진|측정|수치).*(?:변화|추이|그래프)/.test(textToSend) ||
        /(?:그래프|추이|차트).*(?:확인|보여|아래)/.test(res.assistant_message);
      const isExplicitRecordQuery =
        res.intent === "query_records" ||
        /(?:기록|검진\s*결과|내역|이력).*(?:보여|알려|조회|확인|찾아)/.test(textToSend);

      const shouldExecuteQuery =
        Boolean(runtime) &&
        (res.intent === "query_records" || isExplicitDocRequest || isTrendRequest || isExplicitRecordQuery);

      if (shouldExecuteQuery) {
        await executeLocalQuery(
          res.query_draft?.record_type,
          res.query_draft?.time_range,
          res.query_draft?.keyword,
          textToSend,
          assistantMsgId,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "응답을 받지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function executeLocalQuery(
    recordType?: string | null,
    timeRange?: string | null,
    keyword?: string | null,
    rawQueryText?: string,
    assistantMsgId?: string,
  ) {
    if (!runtime || !profile) return;
    try {
      const isTrendQuery =
        recordType === "trend" ||
        keyword === "trend" ||
        (keyword && (keyword.includes("그래프") || keyword.includes("변화") || keyword.includes("추이") || keyword.includes("수치"))) ||
        Boolean(rawQueryText && (rawQueryText.includes("그래프") || rawQueryText.includes("변화") || rawQueryText.includes("추이") || rawQueryText.includes("트렌드") || rawQueryText.includes("수치")));

      // 사용자가 "원본", "서류", "사진", "스캔", "문서", "이미지" 등을 명시적으로 요구했을 때만 원본 이미지 노출
      const isExplicitOriginalDocRequest =
        Boolean(rawQueryText && /(?:원본|서류|사진|스캔|문서|이미지)/.test(rawQueryText)) ||
        keyword === "원본";

      // 사용자가 "모든 서류", "여태 올린 서류 전부", "전체 문서"처럼 전체 목록을 명시적으로 요구했는지 여부
      const isExplicitAllDocsRequest =
        isExplicitOriginalDocRequest &&
        Boolean(rawQueryText && /(?:전체|모든|여태|전부|모두|다\s*보여)/.test(rawQueryText));

      const targetTypes = normalizeRecordTypes(recordType);

      const qRes = await runtime.healthRecords.query({
        profileId: profile.id,
        recordTypes: targetTypes,
        includeDeleted: false,
      });

      if (qRes.ok) {
        let list = filterRecordsByTimeRange(qRes.value, timeRange);
        const validKeyword = isValidContentKeyword(keyword);

        if (validKeyword) {
          list = list.filter((r) => JSON.stringify(r.payload).includes(validKeyword));
        }

        // 시계열 그래프용 지표 추출 (전체 기록 또는 조회 기록 대상)
        const metrics = extractMetricsFromRecords(qRes.value);
        const trendInitialKey = rawQueryText ? detectMetricKeyFromQuery(rawQueryText) : "bp";
        const hasTrendData = Boolean(isTrendQuery && metrics.length > 0);

        // 조회 결과는 드로어 전역 임시 상태가 아니라 이 답변 메시지에 붙인다.
        // 그래야 다음 질문을 보내도 이전 표·원본 서류·그래프가 그 대화 자리에 남는다.
        let queriedRecords: HealthRecord[] | undefined;
        let queriedRecordsTitle: string | undefined;

        if (isExplicitOriginalDocRequest) {
          queriedRecords = undefined;
        } else if (hasTrendData) {
          queriedRecords = undefined;
        } else if (isTrendQuery) {
          if (list.length > 0) {
            queriedRecords = list;
            queriedRecordsTitle = "수치 변화 그래프를 그릴 수 있는 측정 데이터가 부족하여 관련 기록 목록을 표시합니다.";
          }
        } else {
          queriedRecords = list.length > 0 ? list : undefined;
        }

        // 사용자가 명시적으로 원본 서류를 요청한 경우에만 attachedDocs 수집
        const attachedDocs: Array<{ id: string; fileName?: string }> = [];
        if (isExplicitOriginalDocRequest) {
          const docIds = new Set<string>();

          // timeRange가 적용된 list를 기준으로 서류 ID가 있는 기록들을 검진일자(recordedAt) 최신순으로 정렬
          const allScreeningsWithDoc = [...list]
            .filter((r) => r.sourceDocumentId)
            .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

          if (isExplicitAllDocsRequest) {
            // "모든/전체 서류"를 요청한 경우: 전체 검진 서류를 수집
            for (const r of allScreeningsWithDoc) {
              if (r.sourceDocumentId && !docIds.has(r.sourceDocumentId)) {
                docIds.add(r.sourceDocumentId);
                const p = r.payload as Record<string, unknown>;
                attachedDocs.push({
                  id: r.sourceDocumentId,
                  fileName: (p.screeningName as string) || (p.testName as string) || undefined,
                });
              }
            }
            // 서류함 전체도 필요하다면 조회
            if (attachedDocs.length === 0 && runtime.documents) {
              const docListRes = await runtime.documents.list(profile.id);
              if (docListRes.ok) {
                for (const doc of docListRes.value) {
                  if (!docIds.has(doc.id)) {
                    docIds.add(doc.id);
                    attachedDocs.push({ id: doc.id, fileName: doc.fileName });
                  }
                }
              }
            }
          } else {
            // "최근 건강검진 결과 원본 보여줘" 등 단수/최신 서류 요청인 경우:
            // 가장 최신 검진 레코드 1건(또는 동일한 최근 검진 일자의 서류들)만 타겟팅!
            if (allScreeningsWithDoc.length > 0) {
              const latestScreening = allScreeningsWithDoc[0];
              const targetRecordedAtDay = latestScreening.recordedAt.slice(0, 10);
              // 같은 검진 이벤트(동일 날짜)에 속한 서류 페이지만 수집 (단일 장 또는 여러 페이지)
              for (const r of allScreeningsWithDoc) {
                if (
                  r.sourceDocumentId &&
                  r.recordedAt.startsWith(targetRecordedAtDay) &&
                  !docIds.has(r.sourceDocumentId)
                ) {
                  docIds.add(r.sourceDocumentId);
                  const p = r.payload as Record<string, unknown>;
                  attachedDocs.push({
                    id: r.sourceDocumentId,
                    fileName: (p.screeningName as string) || (p.testName as string) || undefined,
                  });
                }
              }
            } else if (runtime.documents) {
              // 레코드 연결이 없더라도 서류함의 가장 최신 서류 1건만 반환
              const docListRes = await runtime.documents.list(profile.id);
              if (docListRes.ok && docListRes.value.length > 0) {
                const latestDoc = docListRes.value[0];
                attachedDocs.push({ id: latestDoc.id, fileName: latestDoc.fileName });
              }
            }
          }
        }

        if (assistantMsgId) {
          const emptyOriginalDocumentMessage =
            "저장된 원본 검진 서류를 찾지 못했습니다. 먼저 검진표 이미지를 업로드하고 저장해 주세요.";
          const emptyTrendMessage =
            "시계열 수치 변화 그래프를 그릴 수 있는 검진 또는 측정 기록을 찾지 못했습니다. 건강검진 결과나 혈압·혈당 기록을 먼저 등록해 주세요.";

          let finalContent: string | undefined;
          if (isExplicitOriginalDocRequest && attachedDocs.length === 0) {
            finalContent = emptyOriginalDocumentMessage;
          } else if (isTrendQuery && !hasTrendData && (!queriedRecords || queriedRecords.length === 0)) {
            finalContent = emptyTrendMessage;
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: finalContent ?? m.content,
                    attachedDocuments: attachedDocs.length > 0 ? attachedDocs : undefined,
                    queriedRecords,
                    queriedRecordsTitle,
                    showTrendChart: hasTrendData,
                    trendMetrics: hasTrendData ? metrics : undefined,
                    trendInitialKey: hasTrendData ? trendInitialKey : undefined,
                  }
                : m,
            ),
          );
        }
      }
    } catch (e) {
      console.error("Failed to query local records:", e);
    }
  }

  // 원본 서류 이미지 열람 핸들러
  async function openSourceDocument(documentId: string) {
    if (!runtime || !runtime.documents) return;
    try {
      const docRes = await runtime.documents.readById(documentId);
      if (!docRes.ok) throw new Error(docRes.error.message);
      const url = URL.createObjectURL(docRes.value.file);
      setSourcePreviewModal({ url, name: docRes.value.fileName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "원본 서류를 열람하지 못했습니다.");
    }
  }

  // 운동 초안 로컬 저장
  async function saveStructuredDraftAutomatically(response: HealthAssistantResponse, msgId: string): Promise<boolean> {
    if (response.intent === "record_exercise" && response.exercise_draft) return saveExercise(response.exercise_draft, msgId);
    if (response.intent === "record_blood_pressure" && response.blood_pressure_draft) return saveBloodPressure(response.blood_pressure_draft, msgId);
    if (response.intent === "record_blood_glucose" && response.blood_glucose_draft) return saveBloodGlucose(response.blood_glucose_draft, msgId);
    if (response.intent === "record_medication" && response.medication_draft) return saveMedication(response.medication_draft, msgId);
    if (response.intent === "record_pain" && response.pain_draft) return savePain(response.pain_draft, msgId);
    return false;
  }

  async function saveExercise(draft: ExerciseDraft, msgId: string): Promise<boolean> {
    if (!runtime || !profile) return false;
    setLoading(true);
    try {
      const details: string[] = [];
      if (draft.distance_km) details.push(`${draft.distance_km}km`);
      if (draft.duration_minutes) details.push(`${draft.duration_minutes}분`);
      if (draft.weight_kg) details.push(`${draft.weight_kg}kg`);
      if (draft.reps) details.push(`${draft.reps}회`);
      if (draft.sets) details.push(`${draft.sets}세트`);
      const summaryText = `${draft.exercise_name}${details.length > 0 ? ` (${details.join(" · ")})` : ""}`.trim();

      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "exercise",
        recordedAt: draft.date_str ? new Date(draft.date_str).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "exercise",
          exerciseName: draft.exercise_name,
          distanceKm: draft.distance_km ?? undefined,
          weightKg: draft.weight_kg ?? undefined,
          reps: draft.reps ?? undefined,
          sets: draft.sets ?? undefined,
          durationMinutes: draft.duration_minutes ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();

      const todayResult = await runtime.healthRecords.query({
        profileId: profile.id,
        recordTypes: ["exercise"],
        includeDeleted: false,
      });
      if (todayResult.ok) {
        const todayExercises = filterRecordsByTimeRange(todayResult.value, "today");
        setMessages((prev) =>
          prev.map((message) =>
            message.id === msgId
              ? {
                  ...message,
                  queriedRecords: todayExercises,
                  queriedRecordsTitle: `오늘 운동 기록 (${todayExercises.length}건)`,
                }
              : message,
          ),
        );
      }
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "운동 기록 저장에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // 혈압 초안 로컬 저장
  async function saveBloodPressure(draft: BloodPressureDraft, msgId: string): Promise<boolean> {
    if (!runtime || !profile || !draft.systolic || !draft.diastolic) return false;
    setLoading(true);
    try {
      const summaryText = `혈압 ${draft.systolic}/${draft.diastolic} mmHg${draft.pulse ? ` (맥박 ${draft.pulse})` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "blood_pressure",
        recordedAt: draft.measured_at ? new Date(draft.measured_at).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "blood_pressure",
          systolicMmHg: draft.systolic,
          diastolicMmHg: draft.diastolic,
          pulseBpm: draft.pulse ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "혈압 기록 저장에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveBloodGlucose(draft: BloodGlucoseDraft, msgId: string): Promise<boolean> {
    if (!runtime || !profile || !draft.value) return false;
    setLoading(true);
    try {
      const timing = normalizeBloodGlucoseTiming(draft.timing);
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "blood_glucose",
        recordedAt: draft.measured_at ? new Date(draft.measured_at).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "blood_glucose",
          valueMgDl: draft.value,
          timing,
          note: draft.note || `혈당 ${draft.value}mg/dL`,
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      setMessages((prev) => prev.map((message) => message.id === msgId ? { ...message, saved: true } : message));
      if (onRecordSaved) await onRecordSaved();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "혈당 기록 저장에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // 복약 초안 로컬 저장
  async function saveMedication(draft: MedicationDraft, msgId: string): Promise<boolean> {
    if (!runtime || !profile || !draft.medication_name) return false;
    setLoading(true);
    try {
      const summaryText = `복약: ${draft.medication_name}${draft.dosage ? ` ${draft.dosage}` : ""}${draft.taken_at ? ` (${draft.taken_at})` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "medication",
        recordedAt: new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "medication",
          medicationName: draft.medication_name,
          dosage: draft.dosage ?? undefined,
          takenAt: draft.taken_at ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "복약 기록 저장에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // 통증 초안 로컬 저장
  async function savePain(draft: PainDraft, msgId: string): Promise<boolean> {
    if (!runtime || !profile || !draft.body_area) return false;
    setLoading(true);
    try {
      const summaryText = `통증: ${draft.body_area} (강도 ${draft.intensity}/10)${draft.sensation ? ` - ${draft.sensation}` : ""}`;
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "pain",
        recordedAt: draft.onset_at ? new Date(draft.onset_at).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          type: "pain",
          bodyArea: draft.body_area,
          intensity: draft.intensity,
          sensation: draft.sensation ?? undefined,
          onsetAt: draft.onset_at ?? undefined,
          note: draft.note || summaryText,
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통증 기록 저장에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // 검진/검사 서류 결과 로컬 저장 (원본 이미지 문서 보관 연계)
  async function saveLabResult(draft: LabResultDraft, msgId: string, imageFile?: File) {
    if (!runtime || !profile) return;
    setLoading(true);
    try {
      let primaryDocumentId: string | undefined;
      // 첨부된 원본 이미지가 있다면 로컬 암호화 서류 저장소에 보관
      if (runtime.documents && imageFile) {
        const savedDoc = await runtime.documents.save({
          householdId: PRIMARY_HOUSEHOLD_ID,
          profileId: profile.id,
          file: imageFile,
          fileName: imageFile.name,
        });
        if (!savedDoc.ok) throw new Error(savedDoc.error.message);
        primaryDocumentId = savedDoc.value.id;
      }

      const finalNote = [
        draft.summary ? `[검진 요약]\n${draft.summary}` : "",
        draft.items_summary ? `[검사 항목 및 결과]\n${draft.items_summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "health_screening",
        recordedAt: draft.recorded_at ? new Date(draft.recorded_at).toISOString() : new Date().toISOString(),
        source: imageFile ? "ocr" : "local_ai",
        sourceDocumentId: primaryDocumentId,
        payload: {
          type: "health_screening",
          screeningName: draft.screening_name || "건강검진",
          institution: draft.institution ?? undefined,
          summary: draft.summary ?? "",
          itemsSummary: draft.items_summary ?? "",
          note: finalNote || draft.summary || "건강검진 결과",
        },
      });

      if (!result.ok) throw new Error(result.error.message);

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, saved: true } : m)),
      );
      if (onRecordSaved) await onRecordSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검진 결과 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * 챌린지 초안 저장 — **project 에서는 아직 막혀 있다.**
   *
   * PR 원본은 주차별 계획(`runtime.challenges.createPlan` — 활성 계획·주차별 과제·
   * 휴식일)을 로컬 암호화 보관함에 저장했다. project 의 챌린지는 그 모델이 아니다 —
   * 서버가 도는 **일일 체크**(`/challenges/today` · `/challenges/checks` ·
   * `/challenges/garden`)이고 "계획"·"과제 분"·"휴식일" 이라는 개념이 없다.
   *
   * 없는 개념에 억지로 매핑하면 대화로 만든 챌린지와 챌린지 화면이 서로 다른 것을
   * 보여 준다. 그래서 만들지 않고 어디서 만들면 되는지를 말한다. 모델을 맞추는 것이
   * 이 기능의 남은 일이다.
   */
  async function saveChallenge() {
    setError("챌린지는 챌린지 화면에서 만들어 주세요. 대화로 만드는 것은 아직 준비 중이에요.");
  }

  const quickPrompts = [
    "검진 수치 변화 그래프",
    "최근 건강검진 결과 원본 보여줘",
    "혈압 120에 80 나왔어",
    "랫풀다운 20kg 10개 3세트 했어",
    "저녁 8시에 타이레놀 1알 복용했어",
  ];

  return (
    <div className="health-assistant-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <aside className="health-assistant-drawer" role="dialog" aria-label="AI 건강 비서 봄이">
        {/* 헤더 */}
        <header className="assistant-header">
          <div className="assistant-header-title">
            <span className="assistant-avatar" aria-hidden="true">봄</span>
            <div>
              <h3>봄이 · 건강 비서</h3>
              <p>
                {profile ? (
                  <span className="target-profile-pill">{profile.displayName} ({profile.relationship})</span>
                ) : (
                  <span>프로필을 선택해 주세요</span>
                )}
                <span className="privacy-pill">기록은 기기에 암호화 보관</span>
              </p>
            </div>
          </div>
          <div className="assistant-header-actions">
            {messages.length > 1 && (
              <button
                className="assistant-clear-btn"
                type="button"
                onClick={handleClearChat}
                title="대화 내용을 비우고 새 대화를 시작합니다"
                aria-label="새 대화 시작"
              >
                새 대화
              </button>
            )}
            <button className="assistant-close-btn" type="button" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
        </header>

        {/* 메시지 리스트 */}
        <div ref={messagesContainerRef} className="assistant-messages-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`assistant-message-row ${msg.role}`}>
              {msg.role === "assistant" && (
                <span className="msg-avatar" aria-hidden="true">봄</span>
              )}
              <div className="msg-bubble-wrap">
                {/* 첨부 이미지 썸네일 (사용자가 이미지를 전송한 경우) */}
                {msg.imageBlobUrl && (
                  <div className="msg-attached-image">
                    <img src={msg.imageBlobUrl} alt="업로드된 건강 서류" />
                  </div>
                )}

                <div className="msg-bubble">
                  {msg.content ? (
                    msg.content.split("\n\n").map((para, i) => (
                      <p key={i}>{para}</p>
                    ))
                  ) : (
                    <div className="loading-dots">
                      <span>.</span><span>.</span><span>.</span>
                    </div>
                  )}

                  {/* 응급 주의사항 배너 */}
                  {msg.responseDraft?.emergency_notice && (
                    <div className="emergency-notice-banner" role="alert">
                      <strong>응급 주의 안내</strong>
                      <p>{msg.responseDraft.emergency_notice}</p>
                    </div>
                  )}

                  {/* 비진단 안전 안내문 */}
                  {msg.responseDraft?.safety_disclaimer && (
                    <p className="safety-disclaimer-text">
                      ※ {msg.responseDraft.safety_disclaimer}
                    </p>
                  )}
                </div>

                {/* 대화 내 인라인 원본 서류 이미지 미리보기 목록 (단일/다중 모두 지원) */}
                {msg.attachedDocuments && msg.attachedDocuments.length > 0 && runtime && (
                  <div className="attached-docs-container">
                    {msg.attachedDocuments.map((doc) => (
                      <InlineDocumentPreview
                        key={doc.id}
                        documentId={doc.id}
                        runtime={runtime}
                        onOpen={() => openSourceDocument(doc.id)}
                      />
                    ))}
                  </div>
                )}

                {/* 운동 초안 확인 카드 */}
                {msg.responseDraft?.exercise_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <ExerciseConfirmationCard
                    draft={msg.responseDraft.exercise_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveExercise(updated, msg.id)}
                  />
                )}

                {/* 혈압 초안 확인 카드 */}
                {msg.responseDraft?.blood_pressure_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                    <BloodPressureConfirmationCard
                      draft={msg.responseDraft.blood_pressure_draft}
                      saved={Boolean(msg.saved)}
                      onSave={(updated) => saveBloodPressure(updated, msg.id)}
                    />
                  )}

                {/* 복약 초안 확인 카드 */}
                {msg.responseDraft?.medication_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <MedicationConfirmationCard
                    draft={msg.responseDraft.medication_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveMedication(updated, msg.id)}
                  />
                )}

                {/* 통증 초안 확인 카드 */}
                {msg.responseDraft?.pain_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <PainConfirmationCard
                    draft={msg.responseDraft.pain_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => savePain(updated, msg.id)}
                  />
                )}

                {/* 검진/검사 서류 초안 확인 카드 */}
                {msg.responseDraft?.lab_result_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.responseDraft.missing_fields.length === 0 &&
                  msg.role === "assistant" && (
                  <LabResultConfirmationCard
                    draft={msg.responseDraft.lab_result_draft}
                    saved={Boolean(msg.saved)}
                    onSave={(updated) => saveLabResult(updated, msg.id, msg.imageFile)}
                  />
                )}

                {/* 챌린지 초안 확인 카드 */}
                {msg.responseDraft?.challenge_draft &&
                  msg.responseDraft.needs_confirmation &&
                  msg.role === "assistant" && (
                  <ChallengeConfirmationCard
                    draft={msg.responseDraft.challenge_draft}
                    saved={Boolean(msg.saved)}
                    onSave={() => saveChallenge()}
                  />
                )}

                {/* 시계열 검진/측정 수치 변화 추이 차트 카드 */}
                {msg.showTrendChart && msg.trendMetrics && msg.trendMetrics.length > 0 && (
                  <HealthMetricsTrendCard seriesList={msg.trendMetrics} initialKey={msg.trendInitialKey} />
                )}

                {msg.queriedRecords && (
                  <QueriedRecordsView
                    records={msg.queriedRecords}
                    title={msg.queriedRecordsTitle}
                    onNavigate={onNavigateToRecords}
                    onOpenDocument={openSourceDocument}
                  />
                )}

                {/* AI 추천 퀵 리플라이 칩 */}
                {msg.responseDraft?.suggested_quick_replies &&
                  msg.responseDraft.suggested_quick_replies.length > 0 &&
                  !msg.saved && (
                    <div className="quick-reply-chips">
                      {msg.responseDraft.suggested_quick_replies.map((reply, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="chip-btn"
                          onClick={() => void handleSend(reply)}
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          ))}

          {error && <div className="assistant-error-alert">{error}</div>}
          <div ref={messagesEndRef} />
        </div>

        {/* 하단 입력창 및 퀵 프롬프트 */}
        <footer className="assistant-footer">
          <div className="quick-prompts-bar">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="prompt-chip"
                onClick={() => void handleSend(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* 선택된 이미지 미리보기 바 */}
          {imagePreview && selectedImage && (
            <div className="assistant-selected-image-bar">
              <img src={imagePreview} alt="선택된 이미지 미리보기" className="image-thumb" />
              <div className="image-info">
                <strong>{selectedImage.name}</strong>
                <small>{(selectedImage.size / 1024 / 1024).toFixed(2)} MB</small>
              </div>
              <button
                type="button"
                className="clear-image-btn"
                onClick={clearSelectedImage}
                aria-label="선택 취소"
              >
                ×
              </button>
            </div>
          )}

          <p className="assistant-data-notice">
            AI 답변 생성을 위해 입력 내용과 질문에 필요한 최근 기록 일부가 외부 AI로 전송될 수 있습니다.
          </p>
          <form
            className="assistant-input-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            {/* 숨겨진 이미지 파일 인풋 */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleImageSelect}
            />
            {/* + 버튼 (이미지 파일 업로드) */}
            <button
              type="button"
              className="assistant-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="검진표/서류 이미지 업로드"
              title="검진표/서류 이미지 업로드"
              disabled={loading || !profile}
            >
              +
            </button>

            <input
              type="text"
              placeholder={selectedImage ? "서류에 대해 추가할 메모나 질문을 적어주세요..." : "건강정보를 입력하거나 질문하세요..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || !profile}
            />
            <button
              type="submit"
              className="assistant-send-btn"
              disabled={(!input.trim() && !selectedImage) || loading || !profile}
            >
              전송
            </button>
          </form>
        </footer>
      </aside>

      {/* 원본 서류 이미지 크게 보기 모달 */}
      {sourcePreviewModal && (
        <div className="modal-backdrop source-preview-backdrop" role="presentation" onMouseDown={() => setSourcePreviewModal(null)}>
          <section className="source-preview-modal" role="dialog" aria-modal="true" aria-label="연결된 원본 서류" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <strong>{sourcePreviewModal.name}</strong>
              <button type="button" aria-label="닫기" onClick={() => setSourcePreviewModal(null)}>×</button>
            </header>
            <div className="source-image-wrap">
              <img src={sourcePreviewModal.url} alt="건강기록에 연결된 원본 서류 이미지" />
            </div>
          </section>
        </div>
      )}

      {/* 건강 서류 상세 검토 및 건강기록 확정 저장 모달 */}
      {ocrModalOpen && ocrImagePreviewUrl && (
        <OcrReviewModal
          // 인식 결과가 바뀌면 새로 마운트한다. 모달 안의 편집 상태를 effect 로
          // 되맞추는 대신 이 한 줄로 끝낸다.
          // 초안이 늦게 도착하면 **새로 마운트**한다. 예전에는 effect 로 상태를
          // 되맞췄는데 그게 렌더 연쇄를 만들었다. 초안이 오기 전에는 채울 값이
          // 기본값뿐이라 잃을 편집도 없다.
          key={`${ocrImagePreviewUrl}:${ocrReviewDraft ? "draft" : "empty"}`}
          profileName={profile.displayName}
          imageUrl={ocrImagePreviewUrl}
          fileName={ocrImageFile?.name ?? "검진 서류"}
          draft={ocrReviewDraft}
          items={ocrReviewItems}
          error={ocrModalError}
          working={ocrModalWorking}
          onClose={() => {
            setOcrModalOpen(false);
            clearSelectedImage();
          }}
          onConfirm={(updatedDraft, updatedItems) => void handleConfirmOcrModalSave(updatedDraft, updatedItems)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 건강 서류 상세 검토 및 저장 모달 (2분할 분할 뷰)
// -------------------------------------------------------------
function OcrReviewModal({
  profileName,
  imageUrl,
  fileName,
  draft,
  items,
  error,
  working,
  onClose,
  onConfirm,
}: {
  profileName: string;
  imageUrl: string;
  fileName: string;
  draft: LabResultDraft | null;
  items: OcrReviewItem[];
  error?: string;
  working: boolean;
  onClose: () => void;
  onConfirm: (draft: LabResultDraft, items: OcrReviewItem[]) => void;
}) {
  const [recordedAt, setRecordedAt] = useState(draft?.recorded_at ?? new Date().toISOString().slice(0, 10));
  const [screeningName, setScreeningName] = useState(draft?.screening_name ?? "국가건강검진");
  const [institution, setInstitution] = useState(draft?.institution ?? "");
  const [itemsSummary, setItemsSummary] = useState(draft?.items_summary ?? "");
  const [summary, setSummary] = useState(draft?.summary ?? "");
  // 사용자가 표의 값을 고칠 수 있어서 상태로 둔다. **초기값으로만 받고 effect 로
  // 다시 맞추지 않는다** — 그 동기화 effect 가 렌더 연쇄를 만들었다. 대신 호출부가
  // 인식 결과마다 `key` 를 바꿔 새로 마운트시키므로 초기값이 항상 최신이다.
  const [reviewItems, setReviewItems] = useState<OcrReviewItem[]>(items);

  return (
    <div className="modal-backdrop ocr-split-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel ocr-split-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="section-kicker">건강검진 결과 확인</p>
            <h2>{profileName}님의 {fileName} 분석 결과</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <p className="form-notice">
          ※ 원본 서류와 AI 추출 내용을 꼼꼼히 대조해 주세요. 실제 검사일자와 수치를 수정한 후 저장할 수 있습니다.
        </p>

        <div className="ocr-split-body">
          {/* 왼쪽: 원본 서류 이미지 미리보기 */}
          <div className="ocr-split-left">
            <div className="ocr-preview-header">
              <strong>원본 서류 ({fileName})</strong>
            </div>
            <div className="ocr-preview-image-scroll">
              <img src={imageUrl} alt={fileName} />
            </div>
          </div>

          {/* 오른쪽: 서류에서 확인한 내용 및 편집 폼 */}
          <div className="ocr-split-right">
            {error ? (
              <div className="ocr-modal-error" role="alert">
                <strong>서류를 분석하지 못했습니다.</strong>
                <p>{error}</p>
                <button className="secondary-button" type="button" onClick={onClose}>다른 파일 선택하기</button>
              </div>
            ) : working && !draft ? (
              <div className="ocr-modal-loading">
                <div className="loading-dots">
                  <span>●</span><span>●</span><span>●</span>
                </div>
                <p>AI가 서류의 검사 항목과 판정일자를 정밀 분석하고 있습니다…</p>
              </div>
            ) : (
              <div className="ocr-edit-fields">
                <div className="compact-row">
                  <label>
                    실제 검사/판정 일자
                    <input
                      type="date"
                      value={recordedAt}
                      onChange={(e) => setRecordedAt(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    검진·서류명
                    <input
                      value={screeningName}
                      onChange={(e) => setScreeningName(e.target.value)}
                      placeholder="국가건강검진 등"
                    />
                  </label>
                </div>

                <label>
                  검진 기관
                  <input
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    placeholder="병원/검진기관명"
                  />
                </label>

                {reviewItems.length > 0 ? (
                  <div className="ocr-structured-items">
                    <div><strong>검사 항목 확인</strong><small>항목·결과·단위·판정을 원본과 비교해 수정하세요.</small></div>
                    {reviewItems.map((item, index) => (
                      <div className="ocr-structured-item" key={`${item.testName}-${index}`}>
                        <input aria-label={`${index + 1}번째 검사항목`} value={item.testName} onChange={(event) => setReviewItems(reviewItems.map((current, currentIndex) => currentIndex === index ? { ...current, testName: event.currentTarget.value } : current))} />
                        <input aria-label={`${index + 1}번째 결과값`} value={item.value} onChange={(event) => setReviewItems(reviewItems.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.currentTarget.value } : current))} />
                        <input aria-label={`${index + 1}번째 단위`} value={item.unit} onChange={(event) => setReviewItems(reviewItems.map((current, currentIndex) => currentIndex === index ? { ...current, unit: event.currentTarget.value } : current))} />
                        <input aria-label={`${index + 1}번째 판정`} value={item.judgment} onChange={(event) => setReviewItems(reviewItems.map((current, currentIndex) => currentIndex === index ? { ...current, judgment: event.currentTarget.value } : current))} />
                      </div>
                    ))}
                  </div>
                ) : null}

                <label>
                  전체 검사 항목 및 수치 (혈액, 계측, 요검사, 노인기능평가 등)
                  <textarea
                    rows={6}
                    value={itemsSummary}
                    onChange={(e) => setItemsSummary(e.target.value)}
                    placeholder="검사 수치 및 판정 내용"
                  />
                </label>

                <label>
                  검진 핵심 요약
                  <textarea
                    rows={2}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="종합 소견 및 요약"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={working || Boolean(error) || !draft || !recordedAt}
            onClick={() => onConfirm({
              screening_name: screeningName,
              recorded_at: recordedAt,
              institution,
              items_summary: itemsSummary,
              summary,
            }, reviewItems)}
          >
            {working ? "저장 중…" : "수정 내용 확정 · 건강기록 저장"}
          </button>
        </div>
      </section>
    </div>
  );
}

// -------------------------------------------------------------
// 하위 확인 카드 컴포넌트들
// -------------------------------------------------------------

function ExerciseConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: ExerciseDraft;
  saved: boolean;
  onSave: (updated: ExerciseDraft) => void;
}) {
  const [exerciseName, setExerciseName] = useState(draft.exercise_name);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(draft.distance_km ?? undefined);
  const [durationMinutes, setDurationMinutes] = useState<number | undefined>(draft.duration_minutes ?? undefined);
  const [weightKg, setWeightKg] = useState<number | undefined>(draft.weight_kg ?? undefined);
  const [reps, setReps] = useState<number | undefined>(draft.reps ?? undefined);
  const [sets, setSets] = useState<number | undefined>(draft.sets ?? undefined);
  const [showWeightFields, setShowWeightFields] = useState<boolean>(
    Boolean(draft.weight_kg || draft.reps || draft.sets),
  );
  const [dateStr, setDateStr] = useState<string>(
    draft.date_str || new Date().toISOString().slice(0, 16),
  );

  const isCardio =
    Boolean(draft.distance_km) ||
    /(?:달리기|러닝|조깅|자전거|사이클|라이딩|걷기|산책|마라톤|트레킹|하이킹|유산소|run|cycle|bike|walk)/i.test(
      exerciseName,
    );

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p>
          <strong>{exerciseName}</strong>: {distanceKm ? `거리 ${distanceKm}km · ` : ""}{durationMinutes ? `시간 ${durationMinutes}분 · ` : ""}{weightKg ? `${weightKg}kg ` : ""}{reps ? `${reps}회 ` : ""}{sets ? `${sets}세트` : ""}
          <small style={{ display: "block", color: "#64748b", marginTop: "2px" }}>
            {formatTargetDateTime(dateStr)}
          </small>
        </p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>운동 기록 확인</strong>
        <small>{isCardio ? "운동 거리, 시간 및 일시를 확인하고 저장할 수 있습니다" : "운동 종목, 시간 및 일시를 확인하고 저장할 수 있습니다"}</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label style={{ flex: 1.2 }}>
            종목
            <input
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              placeholder="예: 러닝, 자전거, 랫풀다운"
            />
          </label>
          {isCardio ? (
            <>
              <label style={{ flex: 0.9 }}>
                거리 (km)
                <input
                  type="number"
                  step="0.1"
                  value={distanceKm ?? ""}
                  onChange={(e) => setDistanceKm(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="예: 5.0 (km)"
                />
              </label>
              <label style={{ flex: 0.9 }}>
                시간 (분)
                <input
                  type="number"
                  value={durationMinutes ?? ""}
                  onChange={(e) => setDurationMinutes(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                  placeholder="예: 30 (분)"
                />
              </label>
            </>
          ) : (
            <label style={{ flex: 1 }}>
              운동 시간 (분)
              <input
                type="number"
                value={durationMinutes ?? ""}
                onChange={(e) => setDurationMinutes(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="예: 30 (분)"
              />
            </label>
          )}
        </div>

        {/* 유산소가 아니거나, 근력 필드를 보려는 경우 */}
        {(!isCardio || showWeightFields) && (
          <div className="input-row">
            {!isCardio && (
              <label>
                거리 (km)
                <input
                  type="number"
                  step="0.1"
                  value={distanceKm ?? ""}
                  onChange={(e) => setDistanceKm(e.target.value ? parseFloat(e.target.value) : undefined)}
                  placeholder="km (옵션)"
                />
              </label>
            )}
            <label>
              무게 (kg)
              <input
                type="number"
                value={weightKg ?? ""}
                onChange={(e) => setWeightKg(e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="kg"
              />
            </label>
            <label>
              횟수 (회)
              <input
                type="number"
                value={reps ?? ""}
                onChange={(e) => setReps(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="회"
              />
            </label>
            <label>
              세트
              <input
                type="number"
                value={sets ?? ""}
                onChange={(e) => setSets(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="세트"
              />
            </label>
          </div>
        )}

        {isCardio && !showWeightFields && (
          <button
            type="button"
            className="secondary-toggle-btn"
            style={{ fontSize: "0.78rem", color: "#64748b", background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: "2px 0", marginBottom: "4px" }}
            onClick={() => setShowWeightFields(true)}
          >
            + 중량/세트 추가 입력하기
          </button>
        )}

        <label>
          운동 일시
          <input
            type="datetime-local"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!exerciseName}
        onClick={() =>
          onSave({
            ...draft,
            exercise_name: exerciseName,
            distance_km: distanceKm,
            duration_minutes: durationMinutes,
            weight_kg: weightKg,
            reps,
            sets,
            date_str: dateStr,
          })
        }
      >
        운동 기록에 저장하기
      </button>
    </div>
  );
}

function BloodPressureConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: BloodPressureDraft;
  saved: boolean;
  onSave: (updated: BloodPressureDraft) => void;
}) {
  const [systolic, setSystolic] = useState<number | undefined>(draft.systolic ?? undefined);
  const [diastolic, setDiastolic] = useState<number | undefined>(draft.diastolic ?? undefined);
  const [pulse, setPulse] = useState<number | undefined>(draft.pulse ?? undefined);

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>혈압</strong>: {systolic}/{diastolic} mmHg {pulse ? `(맥박 ${pulse}bpm)` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>혈압 측정치 확인</strong>
        <small>수정 후 저장할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label>
            수축기(높은 수치)
            <input
              type="number"
              value={systolic ?? ""}
              onChange={(e) => setSystolic(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="120"
            />
          </label>
          <label>
            이완기(낮은 수치)
            <input
              type="number"
              value={diastolic ?? ""}
              onChange={(e) => setDiastolic(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="80"
            />
          </label>
          <label>
            맥박(선택)
            <input
              type="number"
              value={pulse ?? ""}
              onChange={(e) => setPulse(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="72"
            />
          </label>
        </div>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!systolic || !diastolic}
        onClick={() => onSave({ ...draft, systolic, diastolic, pulse })}
      >
        혈압 기록에 저장하기
      </button>
    </div>
  );
}

function MedicationConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: MedicationDraft;
  saved: boolean;
  onSave: (updated: MedicationDraft) => void;
}) {
  const [medicationName, setMedicationName] = useState(draft.medication_name);
  const [dosage, setDosage] = useState(draft.dosage ?? "");
  const [takenAt, setTakenAt] = useState(draft.taken_at ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{medicationName}</strong>: {dosage} {takenAt ? `(${takenAt})` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>복약 기록 확인</strong>
        <small>수정 후 저장할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <label>
          약물 이름
          <input
            value={medicationName}
            onChange={(e) => setMedicationName(e.target.value)}
            placeholder="타이레놀 등"
          />
        </label>
        <div className="input-row">
          <label>
            용량/수량
            <input
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="1알, 500mg 등"
            />
          </label>
          <label>
            복용 시각
            <input
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              placeholder="저녁 8시 등"
            />
          </label>
        </div>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!medicationName}
        onClick={() => onSave({ ...draft, medication_name: medicationName, dosage, taken_at: takenAt })}
      >
        복약 기록에 저장하기
      </button>
    </div>
  );
}

function PainConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: PainDraft;
  saved: boolean;
  onSave: (updated: PainDraft) => void;
}) {
  const [bodyArea, setBodyArea] = useState(draft.body_area);
  const [intensity, setIntensity] = useState(draft.intensity ?? 5);
  const [sensation, setSensation] = useState(draft.sensation ?? "");
  const [note, setNote] = useState(draft.note ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{bodyArea}</strong>: 강도 {intensity}/10 {sensation ? `(${sensation})` : ""}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>통증 기록 확인</strong>
        <small>부위와 강도를 확인하고 저장해 주세요</small>
      </div>
      <div className="card-inputs">
        <label>
          통증 부위
          <input
            value={bodyArea}
            onChange={(e) => setBodyArea(e.target.value)}
            placeholder="오른쪽 무릎, 허리, 어깨 등"
          />
        </label>
        <div className="input-row">
          <label>
            통증 강도 ({intensity}/10)
            <div className="pain-intensity-slider-wrap">
              <input
                type="range"
                min="0"
                max="10"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
              <span className="pain-intensity-val">{intensity}</span>
            </div>
          </label>
          <label>
            통증 양상
            <input
              value={sensation}
              onChange={(e) => setSensation(e.target.value)}
              placeholder="욱신거림, 찌르는 듯함 등"
            />
          </label>
        </div>
        {note && (
          <label>
            메모
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="특이사항"
            />
          </label>
        )}
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!bodyArea}
        onClick={() => onSave({ ...draft, body_area: bodyArea, intensity, sensation, note })}
      >
        통증 기록에 저장하기
      </button>
    </div>
  );
}

function InlineDocumentPreview({
  documentId,
  runtime,
  onOpen,
}: {
  documentId: string;
  runtime: LocalDomainRuntime;
  onOpen: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("원본 서류");

  useEffect(() => {
    let active = true;
    let urlToRevoke: string | null = null;

    if (runtime.documents) {
      void runtime.documents.readById(documentId).then((res) => {
        if (active && res.ok) {
          const url = URL.createObjectURL(res.value.file);
          urlToRevoke = url;
          setImageUrl(url);
          setFileName(res.value.fileName);
        }
      });
    }

    return () => {
      active = false;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [documentId, runtime]);

  if (!imageUrl) {
    return (
      <div className="inline-doc-card is-loading">
        <span>서류 이미지를 불러오는 중…</span>
      </div>
    );
  }

  return (
    <div className="inline-doc-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="inline-doc-header">
        <span className="doc-badge">원본 서류</span>
        <strong>{fileName}</strong>
        <span className="expand-hint">클릭하여 확대</span>
      </div>
      <div className="inline-doc-preview-wrap">
        <img src={imageUrl} alt={fileName} />
      </div>
    </div>
  );
}

function LabResultConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: LabResultDraft;
  saved: boolean;
  onSave: (updated: LabResultDraft) => void;
}) {
  const [screeningName, setScreeningName] = useState(draft.screening_name ?? "건강검진");
  const [recordedAt, setRecordedAt] = useState(draft.recorded_at ?? new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState(draft.summary ?? "");
  const [itemsSummary, setItemsSummary] = useState(draft.items_summary ?? "");

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">안전하게 저장되었습니다.</span>
        <p><strong>{screeningName}</strong> ({recordedAt}): {summary || "검진 결과가 안전하게 저장되었습니다."}</p>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card">
      <div className="card-header">
        <strong>검진/검사 결과 확인</strong>
        <small>실제 검사일자를 확인하고 수정할 수 있습니다</small>
      </div>
      <div className="card-inputs">
        <div className="input-row">
          <label>
            실제 검사 일자
            <input
              type="date"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
          </label>
          <label>
            검진·서류명
            <input
              value={screeningName}
              onChange={(e) => setScreeningName(e.target.value)}
              placeholder="국가건강검진, 혈액종합검사 등"
            />
          </label>
        </div>
        {itemsSummary && (
          <label>
            주요 검사 항목
            <textarea
              rows={4}
              value={itemsSummary}
              onChange={(e) => setItemsSummary(e.target.value)}
            />
          </label>
        )}
        <label>
          검진 요약
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="검사 결과 핵심 요약"
          />
        </label>
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        onClick={() => onSave({ ...draft, screening_name: screeningName, recorded_at: recordedAt, summary, items_summary: itemsSummary })}
      >
        건강검진 기록으로 저장하기
      </button>
    </div>
  );
}

function QueriedRecordsView({
  records,
  title,
  onNavigate,
  onOpenDocument,
}: {
  records: HealthRecord[];
  title?: string;
  onNavigate?: () => void;
  onOpenDocument?: (documentId: string) => void;
}) {
  const [showTrend, setShowTrend] = useState(false);
  const trendMetrics = extractMetricsFromRecords(records);

  const RECORD_TYPE_LABELS: Record<string, string> = {
    exercise: "운동",
    blood_pressure: "혈압",
    blood_glucose: "혈당",
    medication: "복약",
    pain: "통증",
    health_screening: "검진",
    lab_result: "검사",
    body_measurement: "체성분",
    walking: "걷기",
    vaccination: "접종",
    note: "메모",
  };

  return (
    <div className="queried-records-card">
      <div className="query-header">
        <strong>{title ?? `조회된 건강 기록 (${records.length}건)`}</strong>
        <div className="query-header-actions">
          {trendMetrics.length > 0 && (
            <button
              type="button"
              className="trend-toggle-header-btn"
              onClick={() => setShowTrend((prev) => !prev)}
            >
              {showTrend ? "목록 표 보기" : "수치 그래프"}
            </button>
          )}
          {onNavigate && (
            <button type="button" className="view-all-link" onClick={onNavigate}>
              전체 보기
            </button>
          )}
        </div>
      </div>

      {showTrend && trendMetrics.length > 0 ? (
        <HealthMetricsTrendCard seriesList={trendMetrics} />
      ) : records.length === 0 ? (
        <p className="query-empty">해당 조건의 저장된 기록이 없습니다.</p>
      ) : (
        <div className="queried-table-wrapper">
          <table className="queried-records-table">
            <thead>
              {records.length > 0 && records.every(r => r.recordType === "exercise") ? (
                <tr>
                  <th scope="col" style={{ width: "25%" }}>기록 일시</th>
                  <th scope="col" style={{ width: "25%" }}>종목</th>
                  <th scope="col" style={{ width: "30%" }}>횟수/무게/거리</th>
                  <th scope="col" style={{ width: "20%" }}>세트/시간</th>
                </tr>
              ) : (
                <tr>
                  <th scope="col" style={{ width: "28%" }}>기록 일시</th>
                  <th scope="col" style={{ width: "16%" }}>종류</th>
                  <th scope="col">상세 내용 및 수치</th>
                  <th scope="col" style={{ width: "20%" }}>서류/관리</th>
                </tr>
              )}
            </thead>
            <tbody>
              {records.slice(0, 10).map((rec) => {
                const p = rec.payload as Record<string, unknown>;
                const isAllExercise = records.every((r) => r.recordType === "exercise");

                if (isAllExercise) {
                  const exerciseName = String(p.exerciseName ?? p.note ?? "운동");
                  const weightDist: string[] = [];
                  if (p.weightKg) weightDist.push(`${p.weightKg}kg`);
                  if (p.distanceKm) weightDist.push(`${p.distanceKm}km`);

                  const repsSetsTime: string[] = [];
                  if (p.reps) repsSetsTime.push(`${p.reps}회`);
                  if (p.sets) repsSetsTime.push(`${p.sets}세트`);
                  if (p.durationMinutes) repsSetsTime.push(`${p.durationMinutes}분`);

                  return (
                    <tr key={rec.id} className="queried-row">
                      <td className="cell-datetime">
                        <span className="datetime-badge">{formatTargetDateTime(rec.recordedAt)}</span>
                      </td>
                      <td className="cell-content">
                        <span className="content-main">{exerciseName}</span>
                      </td>
                      <td className="cell-content">
                        <span className="content-main">{weightDist.length > 0 ? weightDist.join(" · ") : "-"}</span>
                      </td>
                      <td className="cell-content">
                        <span className="content-main">{repsSetsTime.length > 0 ? repsSetsTime.join(" · ") : "-"}</span>
                      </td>
                    </tr>
                  );
                }

                const typeLabel = RECORD_TYPE_LABELS[rec.recordType] || rec.recordType;

                let contentText: string;
                if (rec.recordType === "exercise" || p.exerciseName) {
                  const details: string[] = [];
                  if (p.distanceKm) details.push(`${p.distanceKm}km`);
                  if (p.durationMinutes) details.push(`${p.durationMinutes}분`);
                  if (p.weightKg) details.push(`${p.weightKg}kg`);
                  if (p.reps) details.push(`${p.reps}회`);
                  if (p.sets) details.push(`${p.sets}세트`);
                  contentText = `${p.exerciseName ?? "운동"}${details.length > 0 ? ` (${details.join(" · ")})` : ""}`;
                } else if (rec.recordType === "blood_pressure" || p.systolicMmHg) {
                  contentText = `${p.systolicMmHg}/${p.diastolicMmHg} mmHg${p.pulseBpm ? ` (맥박 ${p.pulseBpm})` : ""}`;
                } else if (rec.recordType === "blood_glucose" || p.valueMgDl) {
                  contentText = `${p.valueMgDl} mg/dL${p.timing ? ` (${p.timing})` : ""}`;
                } else if (rec.recordType === "medication" || p.medicationName) {
                  contentText = `${p.medicationName}${p.dosage ? ` ${p.dosage}` : ""}${p.takenAt ? ` (${p.takenAt})` : ""}`;
                } else if (rec.recordType === "pain" || p.bodyArea) {
                  contentText = `${p.bodyArea} · 강도 ${p.intensity}/10${p.sensation ? ` (${p.sensation})` : ""}`;
                } else if (rec.recordType === "health_screening" || p.screeningName) {
                  contentText = `${p.screeningName ?? "검진"}${p.summary ? ` · ${p.summary}` : ""}`;
                } else {
                  contentText = String(p.note ?? p.summary ?? p.text ?? "-");
                }

                return (
                  <tr key={rec.id} className="queried-row">
                    <td className="cell-datetime">
                      <span className="datetime-badge">{formatTargetDateTime(rec.recordedAt)}</span>
                    </td>
                    <td className="cell-type">
                      <span className={`type-tag tag-${rec.recordType}`}>{typeLabel}</span>
                    </td>
                    <td className="cell-content">
                      <span className="content-main">{contentText}</span>
                      {typeof p.note === "string" && p.note !== contentText && !p.note.startsWith(contentText) && (
                        <small className="content-subnote">{p.note.slice(0, 50)}</small>
                      )}
                    </td>
                    <td className="cell-action">
                      {rec.sourceDocumentId && onOpenDocument ? (
                        <button
                          type="button"
                          className="table-view-source-btn"
                          onClick={() => onOpenDocument(rec.sourceDocumentId!)}
                        >
                          원본 서류
                        </button>
                      ) : (
                        <span className="no-doc-dash">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 건강검진/측정 시계열 수치 변화 그래프 카드 (인터랙티브 차트)
// -------------------------------------------------------------
export function HealthMetricsTrendCard({
  seriesList,
  initialKey,
}: {
  seriesList: MetricSeries[];
  initialKey?: string;
}) {
  const [activeKey, setActiveKey] = useState(
    initialKey && seriesList.some((s) => s.key === initialKey)
      ? initialKey
      : (seriesList[0]?.key ?? "bp"),
  );
  const currentSeries = seriesList.find((s) => s.key === activeKey) || seriesList[0];

  if (!currentSeries || currentSeries.points.length === 0) {
    return (
      <div className="trend-chart-card empty">
        <p>표시할 수치 기록이 없습니다.</p>
      </div>
    );
  }

  const points = currentSeries.points;
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const diff = prev ? latest.value - prev.value : 0;
  const diffSec = prev && latest.secondaryValue && prev.secondaryValue ? latest.secondaryValue - prev.secondaryValue : 0;

  // SVG 좌표 스케일링 계산
  const allValues = [
    ...points.map((p) => p.value),
    ...points.map((p) => p.secondaryValue).filter((v): v is number => typeof v === "number"),
  ];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const valRange = (maxVal - minVal) || 10;
  const yPad = Math.max(2, valRange * 0.15);
  const yMin = Math.max(0, Math.floor(minVal - yPad));
  const yMax = Math.ceil(maxVal + yPad);
  const yRange = (yMax - yMin) || 1;

  const width = 360;
  const height = 180;
  const padLeft = 36;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = (index: number) => {
    if (points.length === 1) return padLeft + plotW / 2;
    return padLeft + (index / (points.length - 1)) * plotW;
  };

  const getY = (val: number) => {
    return padTop + plotH - ((val - yMin) / yRange) * plotH;
  };

  // 주요 선 polyline 점들
  const linePoints = points.map((p, i) => `${getX(i)},${getY(p.value)}`).join(" ");
  const areaPoints = points.length > 1
    ? `${getX(0)},${padTop + plotH} ${linePoints} ${getX(points.length - 1)},${padTop + plotH}`
    : "";

  // 보조선 polyline 점들 (혈압 이완기, ALT 등)
  const hasSecondary = points.some((p) => typeof p.secondaryValue === "number");
  const secLinePoints = hasSecondary
    ? points.filter((p) => typeof p.secondaryValue === "number").map((p, i) => `${getX(i)},${getY(p.secondaryValue!)}`).join(" ")
    : "";

  return (
    <div className="trend-chart-card">
      <div className="trend-chart-header">
        <div>
          <span className="trend-chart-kicker">수치 변화 그래프</span>
          <h4 className="trend-chart-title">{currentSeries.name}</h4>
        </div>
        <div className="trend-latest-stat">
          <span className="trend-latest-val">
            {latest.value}{latest.secondaryValue ? ` / ${latest.secondaryValue}` : ""}
            <small> {currentSeries.unit}</small>
          </span>
          {prev && (
            <span className={`trend-diff-badge ${diff > 0 ? "is-up" : diff < 0 ? "is-down" : "is-same"}`}>
              {diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : "변동 없음"}
              {diffSec !== 0 ? ` (${diffSec > 0 ? `+${diffSec}` : diffSec})` : ""}
            </span>
          )}
        </div>
      </div>

      {/* 지표 탭 바 */}
      {seriesList.length > 1 && (
        <div className="trend-tabs-bar">
          {seriesList.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`trend-tab-btn ${s.key === activeKey ? "active" : ""}`}
              onClick={() => setActiveKey(s.key)}
            >
              {s.name.split(" ")[0]}
            </button>
          ))}
        </div>
      )}

      {/* SVG 그래프 영역 */}
      <div className="trend-svg-container">
        <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg">
          <defs>
            <linearGradient id={`grad-${currentSeries.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={currentSeries.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={currentSeries.color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* 배경 눈금선 (Y축) */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotH / 2} x2={width - padRight} y2={padTop + plotH / 2} stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + plotH} x2={width - padRight} y2={padTop + plotH} stroke="#cbd5e1" strokeWidth="1" />

          {/* Y축 레이블 */}
          <text x={padLeft - 6} y={padTop + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{yMax}</text>
          <text x={padLeft - 6} y={padTop + plotH / 2 + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{Math.round((yMax + yMin) / 2)}</text>
          <text x={padLeft - 6} y={padTop + plotH} textAnchor="end" fontSize="10" fill="#94a3b8">{yMin}</text>

          {/* 면적 채우기 (Area) */}
          {areaPoints && (
            <polygon points={areaPoints} fill={`url(#grad-${currentSeries.key})`} />
          )}

          {/* 주요 선 (Polyline) */}
          {points.length > 1 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={currentSeries.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 보조 선 (Secondary Polyline) */}
          {hasSecondary && secLinePoints && (
            <polyline
              points={secLinePoints}
              fill="none"
              stroke={currentSeries.secondaryColor || "#3b82f6"}
              strokeWidth="2"
              strokeDasharray="4 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 데이터 포인트 (원 + 수치 라벨 + X축 일자) */}
          {points.map((p, i) => {
            const cx = getX(i);
            const cy = getY(p.value);
            return (
              <g key={i}>
                {/* 데이터 점 */}
                <circle cx={cx} cy={cy} r="4" fill="#ffffff" stroke={currentSeries.color} strokeWidth="2.5" />
                {/* 수치 라벨 */}
                <text x={cx} y={cy - 7} textAnchor="middle" fontSize="10" fontWeight="bold" fill={currentSeries.color}>
                  {p.value}
                </text>

                {/* 보조 데이터 점 */}
                {typeof p.secondaryValue === "number" && (
                  <>
                    <circle cx={cx} cy={getY(p.secondaryValue)} r="3.5" fill="#ffffff" stroke={currentSeries.secondaryColor || "#3b82f6"} strokeWidth="2" />
                    <text x={cx} y={getY(p.secondaryValue) + 12} textAnchor="middle" fontSize="9" fontWeight="bold" fill={currentSeries.secondaryColor || "#3b82f6"}>
                      {p.secondaryValue}
                    </text>
                  </>
                )}

                {/* X축 일자 */}
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                  {p.date.slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 및 정상 참고치 안내 */}
      <div className="trend-footer-legend">
        <div className="trend-legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: currentSeries.color }} />
            {currentSeries.name.split(" ")[0]}
          </span>
          {hasSecondary && (
            <span className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: currentSeries.secondaryColor || "#3b82f6" }} />
              {currentSeries.secondaryName || "보조 수치"}
            </span>
          )}
        </div>
        {currentSeries.normalRange && (
          <span className="trend-normal-hint">
            {currentSeries.normalRange.label}
          </span>
        )}
      </div>

      {/* 검사 기록 히스토리 테이블 */}
      <div className="trend-history-table">
        <table>
          <thead>
            <tr>
              <th>검사/측정 일자</th>
              <th>수치 ({currentSeries.unit})</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p, idx) => (
              <tr key={idx}>
                <td>{p.date}</td>
                <td>
                  <strong>{p.value}</strong>
                  {p.secondaryValue ? ` / ${p.secondaryValue}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHALLENGE_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function ChallengeConfirmationCard({
  draft,
  saved,
  onSave,
}: {
  draft: ChallengeDraft;
  saved: boolean;
  onSave: (updated: ChallengeDraft) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [goal, setGoal] = useState(draft.goal);

  if (saved) {
    return (
      <div className="draft-confirm-card is-saved">
        <span className="saved-badge">챌린지가 시작되었습니다!</span>
        <p>
          <strong>{title}</strong>
        </p>
        <small>홈 화면의 '오늘의 챌린지' 카드에서 실천 상태를 확인해 보세요.</small>
      </div>
    );
  }

  return (
    <div className="draft-confirm-card challenge-confirm-card">
      <div className="card-header">
        <strong>{draft.weeks ?? 4}주 맞춤 챌린지 제안</strong>
        <small>계획을 확인하고 '챌린지 시작하기'를 눌러 홈 화면에 등록하세요</small>
      </div>
      <div className="card-inputs">
        <label>
          챌린지 제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 4주 혈압·생활습관 개선 챌린지"
          />
        </label>
        <label>
          실천 목표
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="예: 매일 20분 걷기 및 규칙적인 수면"
          />
        </label>
        {draft.tasks && draft.tasks.length > 0 && (
          <div className="challenge-draft-tasks">
            <span className="tasks-preview-label">주요 실천 과제 미리보기</span>
            <ul className="draft-task-list">
              {draft.tasks.map((task, idx) => (
                <li key={idx} className="draft-task-preview-item">
                  <span className="draft-day-tag">{CHALLENGE_DAY_NAMES[task.day_of_week]}요일</span>
                  <span className="draft-task-name">{task.title}</span>
                  {task.target_minutes ? (
                    <span className="draft-minutes-tag">{task.target_minutes}분</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button
        type="button"
        className="confirm-save-btn"
        disabled={!title.trim() || !goal.trim()}
        onClick={() => onSave({ ...draft, title, goal })}
      >
        🚀 이 챌린지 시작하기 (홈 화면 등록)
      </button>
    </div>
  );
}
