import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { ProceduralBodyMap } from "./ProceduralBodyMap";
import { REGION_COLOR, regionOfStructure, type RegionRisk } from "./bodyRisk";

type AnatomyMetadata = { id: string; name: string; system: string };
type MetadataBundle = { structures: AnatomyMetadata[] };
type SelectedStructure = { name: string; system?: string };
type BodyFocus = "full" | "head" | "upper" | "lower" | "hand";

const MODEL_URL = "/vendor/vanatome/models/z-anatomy-1.4.0-hologram-core.glb";
const FULL_BODY_METADATA_URL = "/vendor/vanatome/releases/1.4.0/full-body.metadata.json";
const ATTRIBUTION_URL = "/vendor/vanatome/ATTRIBUTION.txt";
const SELECTED_COLOR = new THREE.Color(0x38bdf8);
/** 범례에 쓰는 등급 이름. 판정 카드와 같은 말을 써야 두 화면이 같은 뜻으로 읽힌다. */
const LEVEL_TEXT: Record<string, string> = {
  NORMAL: "정상", CAUTION: "주의", HIGH: "높음", VERY_HIGH: "매우 높음",
};
const INTERNAL_SYSTEMS = new Set([
  "cardiovascular", "digestive", "endocrine", "respiratory", "skeletal", "urinary",
]);

export function VanatomeBodyMap({
  profileName,
  risks,
  risksAt,
}: {
  profileName: string;
  /** 고른 기록의 부위별 위험. 없으면 예전처럼 중립 색으로 둔다. */
  risks?: RegionRisk[];
  /** 그 위험이 **언제 잰 몸**인가. 없으면 적지 않는다. */
  risksAt?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const focusCameraRef = useRef<(focus: BodyFocus) => void>(() => undefined);
  // 위험 색칠은 모델을 다시 읽지 않고 재질만 바꾼다. 기록을 바꿀 때마다 5MB 짜리
  // GLB 를 다시 내려받으면 화면이 매번 깜빡인다.
  const paintRisksRef = useRef<(risks: RegionRisk[] | undefined) => void>(() => undefined);
  const focusRegionRef = useRef<(region: string) => void>(() => undefined);
  const [focusedRegion, setFocusedRegion] = useState<string>();
  // 모델 적재는 한 번뿐인데(의존성 [isTestEnvironment]) 위험은 기록을 바꿀 때마다
  // 달라진다. 적재 완료 시점에 최신 값을 읽으려면 ref 여야 한다 — 클로저에 담으면
  // 로딩 중에 기록을 바꾼 사용자가 옛 색을 본다.
  const risksRef = useRef(risks);
  const [selectedStructure, setSelectedStructure] = useState<SelectedStructure>();
  const [activeFocus, setActiveFocus] = useState<BodyFocus>("full");
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const isTestEnvironment = navigator.userAgent.includes("jsdom");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isTestEnvironment) return;

    setLoadProgress(0);
    setLoadError(undefined);
    setSelectedStructure(undefined);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      queueMicrotask(() => setWebGlUnavailable(true));
      return;
    }

    let disposed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06131d);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.8);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 0.8;
    controls.maxDistance = 11;
    controls.target.set(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xb9f6ff, 0x18344b, 1.8));
    const keyLight = new THREE.DirectionalLight(0xbff8ff, 2.2);
    keyLight.position.set(3, 5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    fillLight.position.set(-4, 1, 3);
    scene.add(fillLight);

    const selectableMeshes: THREE.Mesh[] = [];
    const ownedMaterials = new Set<THREE.Material>();
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    // 위험 색으로 칠한 재질. 클릭 선택을 풀 때 **여기로** 되돌려야 한다 —
    // 원본으로 되돌리면 고른 기록의 색이 조용히 사라진다.
    const riskMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const regionMeshes = new Map<string, THREE.Mesh[]>();
    let selectedMesh: THREE.Mesh | undefined;
    let focusAnimationFrame: number | undefined;

    const renderScene = () => renderer.render(scene, camera);
    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderScene();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    controls.addEventListener("change", renderScene);
    resize();

    focusCameraRef.current = (focus) => {
      const presets: Record<BodyFocus, { position: THREE.Vector3; target: THREE.Vector3 }> = {
        full: {
          position: new THREE.Vector3(0, 0.1, 6.8),
          target: new THREE.Vector3(0, 0.15, 0),
        },
        head: {
          position: new THREE.Vector3(0, 2.02, 1.42),
          target: new THREE.Vector3(0, 2.02, 0),
        },
        upper: {
          position: new THREE.Vector3(0, 0.9, 3.15),
          target: new THREE.Vector3(0, 0.9, 0),
        },
        lower: {
          position: new THREE.Vector3(0, -1.15, 3.2),
          target: new THREE.Vector3(0, -1.15, 0),
        },
        hand: {
          position: new THREE.Vector3(0.74, -0.19, 1.35),
          target: new THREE.Vector3(0.74, -0.19, 0.09),
        },
      };
      const preset = presets[focus];
      glideTo(preset.position, preset.target);
    };

    /** 카메라를 부드럽게 옮긴다. 프리셋과 부위 이동이 같은 움직임을 써야 한다. */
    function glideTo(position: THREE.Vector3, target: THREE.Vector3) {
      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const startedAt = performance.now();
      if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        renderScene();
        return;
      }
      const animateFocus = (now: number) => {
        const elapsed = Math.min(1, (now - startedAt) / 420);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        camera.position.lerpVectors(startPosition, position, eased);
        controls.target.lerpVectors(startTarget, target, eased);
        controls.update();
        renderScene();
        if (elapsed < 1) focusAnimationFrame = window.requestAnimationFrame(animateFocus);
      };
      focusAnimationFrame = window.requestAnimationFrame(animateFocus);
    }

    const clearSelectedMaterial = () => {
      if (!selectedMesh) return;
      materialsOf(selectedMesh.material).forEach((material) => {
        if (!ownedMaterials.has(material)) material.dispose();
      });
      const restore = riskMaterials.get(selectedMesh) ?? originalMaterials.get(selectedMesh);
      if (restore) selectedMesh.material = restore;
      selectedMesh = undefined;
      renderScene();
    };
    clearSelectionRef.current = () => {
      clearSelectedMaterial();
      setSelectedStructure(undefined);
    };

    const metadataPromise = fetch(FULL_BODY_METADATA_URL)
      .then((response) => response.ok ? response.json() as Promise<MetadataBundle> : Promise.reject())
      .then((metadata) => new Map(metadata.structures.map((structure) => [structure.id, structure])))
      .catch(() => new Map<string, AnatomyMetadata>());
    const loadTimeout = window.setTimeout(() => {
      if (!disposed) setLoadError("해부학 인체 모델 로딩 시간이 초과되었습니다.");
    }, 30_000);

    new GLTFLoader().load(
      MODEL_URL,
      async (gltf) => {
        if (disposed) return;
        window.clearTimeout(loadTimeout);
        const metadata = await metadataPromise;
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const anatomyId = String(object.userData.anatomyId ?? "");
          const anatomySystem = String(object.userData.anatomySystem ?? "regional-anatomy");
          const bodyShell = anatomyId === "body-shell";
          object.visible = bodyShell || INTERNAL_SYSTEMS.has(anatomySystem);
          if (!object.visible) return;

          const styledMaterials = materialsOf(object.material).map((material) => {
            const styled = material.clone();
            ownedMaterials.add(styled);
            if (!(styled instanceof THREE.MeshStandardMaterial)) return styled;
            styled.metalness = 0;
            styled.roughness = 0.48;
            if (bodyShell) {
              styled.color.setHex(0x4de4ff);
              styled.emissive.setHex(0x0b7895);
              styled.emissiveIntensity = 0.75;
              styled.transparent = true;
              styled.opacity = 0.17;
              styled.depthWrite = false;
              styled.wireframe = true;
              object.renderOrder = 4;
            } else if (anatomySystem === "skeletal") {
              styled.color.lerp(new THREE.Color(0xd9f7ff), 0.72);
              styled.emissive.setHex(0x17475a);
              styled.emissiveIntensity = 0.18;
              styled.transparent = true;
              styled.opacity = 0.72;
            } else {
              styled.emissive.copy(styled.color).multiplyScalar(0.12);
              styled.emissiveIntensity = 0.25;
              styled.transparent = false;
              styled.opacity = 1;
            }
            return styled;
          });
          object.material = Array.isArray(object.material) ? styledMaterials : styledMaterials[0];
          originalMaterials.set(object, object.material);
          const structure = metadata.get(anatomyId);
          object.userData.structureLabel = structure?.name ?? structureLabel(object.name);
          object.userData.structureSystem = structure?.system ?? anatomySystem;
          const region = regionOfStructure(String(object.userData.structureLabel));
          if (region) {
            object.userData.riskRegion = region;
            const bucket = regionMeshes.get(region) ?? [];
            bucket.push(object);
            regionMeshes.set(region, bucket);
          }
          if (!bodyShell) selectableMeshes.push(object);
        });

        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = size.y > 0 ? 4.7 / size.y : 1;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        model.updateMatrixWorld(true);
        scene.add(model);

        /**
         * 부위별 위험을 재질에 입힌다. 위험이 없는 부위는 원래 색으로 되돌린다.
         *
         * 원본을 지우지 않고 `riskMaterials` 에 따로 쌓는 이유는 기록을 바꿔 가며
         * 볼 때 매번 원본이 필요하기 때문이다. 색만 바꾸지 않고 `emissive` 를 같이
         * 올린다 — 이 장면은 배경이 짙어서 색만 바꾸면 어두운 빨강이 검게 보인다.
         */
        const paintRisks = (next: RegionRisk[] | undefined) => {
          const byRegion = new Map((next ?? []).map((risk) => [risk.region, risk]));
          for (const [region, meshes] of regionMeshes) {
            const risk = byRegion.get(region);
            for (const mesh of meshes) {
              const previous = riskMaterials.get(mesh);
              if (previous) {
                materialsOf(previous).forEach((material) => {
                  if (!ownedMaterials.has(material)) material.dispose();
                });
                riskMaterials.delete(mesh);
              }
              const base = originalMaterials.get(mesh);
              if (!base) continue;
              if (!risk) {
                if (mesh !== selectedMesh) mesh.material = base;
                continue;
              }
              const painted = materialsOf(base).map((material) => {
                const clone = material.clone();
                if (clone instanceof THREE.MeshStandardMaterial) {
                  clone.color.setHex(REGION_COLOR[risk.level]);
                  clone.emissive.setHex(REGION_COLOR[risk.level]);
                  clone.emissiveIntensity = risk.level === "NORMAL" ? 0.3 : 0.75;
                  clone.transparent = false;
                  clone.opacity = 1;
                }
                return clone;
              });
              const applied = Array.isArray(base) ? painted : painted[0];
              riskMaterials.set(mesh, applied);
              if (mesh !== selectedMesh) mesh.material = applied;
            }
          }
          renderScene();
        };
        paintRisksRef.current = paintRisks;
        paintRisks(risksRef.current);

        /**
         * 그 장기가 화면 가운데 오도록 카메라를 옮긴다.
         *
         * 프리셋(머리·상반신…)과 달리 좌표를 **모델에서 구한다.** 장기 위치를 상수로
         * 박아 두면 모델이 바뀌는 날 조용히 엉뚱한 곳을 비춘다.
         */
        focusRegionRef.current = (region) => {
          const meshes = regionMeshes.get(region);
          if (!meshes?.length) return;
          const box = new THREE.Box3();
          for (const mesh of meshes) box.expandByObject(mesh);
          if (box.isEmpty()) return;
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          // 장기가 화면을 꽉 채우면 어디에 붙어 있는지를 잃는다. 주변이 조금 보이게 뺀다.
          const distance = Math.max(size.length() * 2.4, 0.9);
          glideTo(new THREE.Vector3(center.x, center.y, center.z + distance), center);
        };

        setLoadProgress(100);
        setLoadError(undefined);
        renderScene();
      },
      (event) => {
        if (disposed || !event.total) return;
        setLoadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
      () => {
        window.clearTimeout(loadTimeout);
        if (!disposed) setLoadError("해부학 인체 모델을 불러오지 못했습니다.");
      },
    );

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | undefined;
    const handlePointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) {
        pointerStart = undefined;
        return;
      }
      pointerStart = undefined;
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0];
      if (!(hit?.object instanceof THREE.Mesh)) return;

      clearSelectedMaterial();
      const mesh = hit.object;
      const highlighted = materialsOf(mesh.material).map((material) => {
        const clone = material.clone();
        if (clone instanceof THREE.MeshStandardMaterial) {
          clone.color.copy(SELECTED_COLOR);
          clone.emissive.setHex(0x0e7490);
          clone.emissiveIntensity = 0.85;
          clone.opacity = 1;
          clone.transparent = false;
        }
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? highlighted : highlighted[0];
      selectedMesh = mesh;
      setSelectedStructure({
        name: String(mesh.userData.structureLabel ?? "선택한 해부 구조"),
        system: systemLabel(String(mesh.userData.structureSystem ?? "")),
      });
      renderScene();
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      controls.removeEventListener("change", renderScene);
      if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);
      controls.dispose();
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      riskMaterials.forEach((material) => {
        materialsOf(material).forEach((entry) => {
          if (!ownedMaterials.has(entry)) entry.dispose();
        });
      });
      ownedMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      clearSelectionRef.current = () => undefined;
      focusCameraRef.current = () => undefined;
      paintRisksRef.current = () => undefined;
      focusRegionRef.current = () => undefined;
    };
  }, [isTestEnvironment]);

  // 기록을 바꾸면 재질만 다시 칠한다. 모델은 그대로 둔다.
  useEffect(() => {
    risksRef.current = risks;
    paintRisksRef.current(risks);
  }, [risks]);

  if (isTestEnvironment || loadError || webGlUnavailable) {
    return (
      <div>
        {loadError || webGlUnavailable ? (
          <p className="body-map-load-notice" role="status">
            {loadError ?? "이 브라우저에서는 3D를 표시할 수 없습니다."} 기본 인체 미리보기를 표시합니다.
          </p>
        ) : null}
        <ProceduralBodyMap profileName={profileName} />
      </div>
    );
  }

  return (
    <section className="body-map-card vanatome-card" aria-labelledby="body-map-title">
      <div className="body-map-copy">
        <p className="section-kicker">해부 구조 미리보기</p>
        <h3 id="body-map-title">{profileName}님의 3D 인체</h3>
        <p>
          {risks && risks.length > 0
            ? `${risksAt ? `${risksAt} 판정` : "고른 판정"} 기준입니다. 아래 부위를 누르면 그 장기로 이동해요.`
            : "인체를 돌려보거나 구조를 선택해 보세요. 아래 기록에서 판정을 고르면 해당 장기가 색으로 표시됩니다."}
        </p>
        {risks && risks.length > 0 ? (
          <ul className="vanatome-risk-legend">
            {risks.map((risk) => (
              <li key={risk.region}>
                {/* 목록이 아니라 **이동 장치**다. 색만 칠해 두면 사용자가 그 장기를
                    인체에서 직접 찾아 돌려야 한다 — 콩팥은 뒤쪽이라 기본 각도에서 안 보인다. */}
                <button
                  type="button"
                  className="vanatome-risk-row"
                  aria-pressed={focusedRegion === risk.region}
                  disabled={loadProgress < 100}
                  onClick={() => {
                    setFocusedRegion(risk.region);
                    setActiveFocus("full");
                    focusRegionRef.current(risk.region);
                  }}
                >
                  <span
                    className="vanatome-risk-dot"
                    style={{ background: `#${REGION_COLOR[risk.level].toString(16).padStart(6, "0")}` }}
                    aria-hidden="true"
                  />
                  <b>{risk.label}</b>
                  <span className="vanatome-risk-level">{LEVEL_TEXT[risk.level]}</span>
                  <small>{risk.diseases.map((disease) => disease.name).join(" · ")}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vanatome-layer-summary"><span>반투명 외피</span><span>골격</span><span>주요 장기</span></p>
        )}
        <div className="vanatome-focus-control">
          <span>빠른 확대</span>
          <div className="vanatome-focus-buttons" aria-label="인체 부위 빠른 확대">
            {(["head", "upper", "lower", "hand"] as const).map((focus) => (
              <button
                key={focus}
                type="button"
                disabled={loadProgress < 100}
                aria-pressed={activeFocus === focus}
                onClick={() => {
                  setActiveFocus(focus);
                  focusCameraRef.current(focus);
                }}
              >
                {{ head: "머리", upper: "상반신", lower: "하반신", hand: "손" }[focus]}
              </button>
            ))}
          </div>
          {activeFocus !== "full" ? (
            <button
              className="vanatome-reset-focus"
              type="button"
              onClick={() => {
                setActiveFocus("full");
                focusCameraRef.current("full");
              }}
            >
              전체 보기
            </button>
          ) : null}
        </div>
        <div className="body-map-selection" aria-live="polite">
          <span>선택한 구조</span>
          <strong>{selectedStructure?.name ?? "인체에서 구조를 선택하세요"}</strong>
          <small>
            {selectedStructure
              ? `${selectedStructure.system ? `${selectedStructure.system} · ` : ""}현재 선택은 저장되지 않습니다.`
              : "드래그는 회전, 클릭은 구조 선택입니다."}
          </small>
        </div>
        <div className="vanatome-actions">
          <button type="button" disabled={!selectedStructure} onClick={() => clearSelectionRef.current()}>선택 해제</button>
        </div>
        <p className="vanatome-attribution">
          모델: Z-Anatomy 기반 Vanatome ·{" "}
          <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer">CC BY-SA 4.0 출처</a>
        </p>
      </div>
      <div className="body-map-viewer vanatome-viewer is-hologram">
        {loadProgress < 100 ? <BodyMapLoading progress={loadProgress} /> : null}
        <canvas ref={canvasRef} aria-label={`${profileName}님의 회전 가능한 해부학 3D 인체 미리보기`} />
        <span className="body-map-hint">드래그하여 회전 · 클릭하여 선택</span>
      </div>
    </section>
  );
}

function BodyMapLoading({ progress }: { progress: number }) {
  return (
    <div className="vanatome-loading" role="status">
      <span>외피·골격·주요 장기를 구성하는 중…</span>
      <small>{progress > 0 ? `${progress}%` : "약 16 MB · 이 서버에서 직접 불러옵니다"}</small>
    </div>
  );
}

function materialsOf(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function structureLabel(meshName: string) {
  return meshName
    .replace(/^body-shell__/, "")
    .replace(/([lr])$/, (_, side: string) => side === "l" ? " (왼쪽)" : " (오른쪽)")
    .replaceAll("_", " ");
}

function systemLabel(system: string) {
  const labels: Record<string, string> = {
    cardiovascular: "심혈관계", digestive: "소화기계", endocrine: "내분비계",
    respiratory: "호흡기계", skeletal: "골격계", urinary: "비뇨기계",
    "regional-anatomy": "외부 해부 구조",
  };
  return labels[system];
}
