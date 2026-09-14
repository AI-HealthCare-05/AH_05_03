import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createExplosionLayout } from "./explosionLayout";
import { decodeModelResponse } from "./modelDownload";
import { PointerTap } from "./pointerTap";
import {
  DEFAULT_VISIBLE_SYSTEMS,
  SYSTEMS,
  type Atlas,
  type HumanAtlasSceneState,
  type HumanAtlasView,
  type Part,
  type SystemId,
} from "./types";

const ATLAS_BASE_URL = "https://human-atlas-seven.vercel.app";

function resolveAtlasUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${ATLAS_BASE_URL}${clean}`;
}

interface HumanAtlasViewerProps {
  onSelectPart?: (partName: string, systemName: string) => void;
  onClose?: () => void;
}

export function HumanAtlasViewer({ onSelectPart }: HumanAtlasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredPart, setHoveredPart] = useState<Part | null>(null);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);

  const [sceneState, setSceneState] = useState<HumanAtlasSceneState>({
    view: "three-quarter",
    explode: 0,
    isolate: false,
    visible: DEFAULT_VISIBLE_SYSTEMS,
    selected: [],
    rotate: false,
    reset: 0,
  });

  const latestState = useRef(sceneState);
  useEffect(() => {
    latestState.current = sceneState;
  }, [sceneState]);

  const onSelectPartRef = useRef(onSelectPart);
  useEffect(() => {
    onSelectPartRef.current = onSelectPart;
  }, [onSelectPart]);

  // 1. atlas.json 메타데이터 로드
  useEffect(() => {
    let cancelled = false;
    async function loadAtlasManifest() {
      try {
        const res = await fetch(resolveAtlasUrl("models/atlas.json"));
        if (!res.ok) throw new Error(`Atlas manifest HTTP ${res.status}`);
        const data: Atlas = await res.json();
        if (!cancelled) {
          setAtlas(data);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "아틀라스 데이터를 불러올 수 없습니다.");
        }
      }
    }
    loadAtlasManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Three.js Scene 및 청크 메쉬 비동기 병합 렌더링
  useEffect(() => {
    if (!atlas || !containerRef.current) return;
    const el = containerRef.current;
    let disposed = false;
    let dirty = true;
    let ready = false;
    let lastView = "";
    let lastReset = -1;
    let layoutKey = "";
    let amount = 0;
    let lastState: HumanAtlasSceneState | null = null;
    const abort = new AbortController();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setLoadError("이 브라우저에서 WebGL을 시작할 수 없습니다.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.5 : 2));
    renderer.setClearColor("#0f172a"); // 몰입형 딥 다크 블루 배경
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 100);
    const controls = new OrbitControls(camera, renderer.domElement);

    camera.position.set(1.4, 1.05, 3.6);
    controls.target.set(0, 0.85, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.minDistance = 0.07;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.96;
    controls.addEventListener("change", () => {
      dirty = true;
    });

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.2));
    const keyLight = new THREE.DirectionalLight(0xfffaf4, 2.5);
    keyLight.position.set(-2, 4, 3);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.9);
    rimLight.position.set(2, 2, -3);
    scene.add(rimLight);

    // 무대 원형 발판
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.7, 0.028, 100),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.2, roughness: 0.6 }),
    );
    platform.position.y = -0.016;
    scene.add(platform);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.63, 0.632, 128),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    scene.add(ring);

    // 인스턴스 셰이더용 DataTexture
    const width = THREE.MathUtils.ceilPowerOfTwo(atlas.parts.length);
    const data = new Float32Array(width * 4);
    const partTexture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
    partTexture.needsUpdate = true;

    const selectedData = new Uint8Array(width * 4);
    const selectionTexture = new THREE.DataTexture(selectedData, width, 1);
    selectionTexture.needsUpdate = true;

    const geometries: THREE.BufferGeometry[] = [];
    const pickers: (THREE.Mesh | undefined)[] = [];
    const centers = atlas.parts.map((p) =>
      new THREE.Vector3()
        .fromArray(p.bounds[0])
        .add(new THREE.Vector3().fromArray(p.bounds[1]))
        .multiplyScalar(0.5),
    );
    const offsets: THREE.Vector3[] = [];
    const bounds = atlas.parts.map(
      (p) => new THREE.Box3(new THREE.Vector3().fromArray(p.bounds[0]), new THREE.Vector3().fromArray(p.bounds[1])),
    );

    // bubblik525/head 기반 치아 및 안구 재질 분리 키 판정
    const resolveMaterialKey = (p: Part): string => {
      const name = p.name.toLowerCase();
      if (/tooth|teeth|incisor|canine|premolar|molar|dens(?:\b|_|\.)/i.test(name)) return "tooth";
      if (/iris|pupil/i.test(name)) return "iris";
      if (/sclera/i.test(name)) return "sclera";
      if (/cornea|lens|vitreous|anterior chamber/i.test(name)) return "cornea";
      return p.system;
    };

    // 시스템 및 커스텀 부위별 재질 생성 함수
    const materialFor = (
      systemOrKey: string,
      customColor?: string,
      customRoughness?: number,
      customMetalness?: number,
      isTransparent?: boolean,
      opacity?: number,
    ) => {
      const def = SYSTEMS.find((s) => s.id === systemOrKey);
      const color = customColor ?? (def ? def.color : "#aebbb8");
      const isSkin = systemOrKey === "integumentary";
      const isMuscular = systemOrKey === "muscular";
      const transparent = isTransparent ?? isSkin;
      const defaultRoughness = isMuscular ? 0.86 : isSkin ? 0.85 : 0.70;
      const defaultMetalness = 0.0;
      const m = new THREE.MeshStandardMaterial({
        color,
        metalness: customMetalness ?? defaultMetalness,
        roughness: customRoughness ?? defaultRoughness,
        side: THREE.DoubleSide,
        transparent,
        opacity: opacity ?? (isSkin ? 0.12 : 1),
        depthWrite: !transparent,
      });

      m.onBeforeCompile = (shader) => {
        shader.uniforms.partState = { value: partTexture };
        shader.uniforms.selectionState = { value: selectionTexture };
        shader.uniforms.stateWidth = { value: width };
        shader.vertexShader =
          "attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected;\n" +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r;",
        );
        shader.fragmentShader =
          "varying float partVisible; varying float partSelected;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;",
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          "#include <dithering_fragment>\nif (partSelected > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.24, 0.75, 0.98), 0.7);",
        );
      };
      return m;
    };

    const mats = new Map<string, THREE.Material>();
    SYSTEMS.forEach((s) => mats.set(s.id, materialFor(s.id)));
    // bubblik525/head 셰이더 & 팔레트: 법랑질 치아, 딥 세이지 홍채, 소프트 아이보리 공막, 투명 각막
    mats.set("tooth", materialFor("tooth", "#e6e1d2", 0.26, 0.04));
    mats.set("iris", materialFor("iris", "#47685e", 0.32, 0.06));
    mats.set("sclera", materialFor("sclera", "#ddd9ca", 0.24, 0.03));
    mats.set("cornea", materialFor("cornea", "#c0dce1", 0.05, 0.08, true, 0.22));

    // 청크 다운로드 및 메쉬 조립
    let loadedChunks = 0;
    const loadChunk = async (ci: number) => {
      const chunk = atlas.chunks[ci];
      const compressed = !!chunk.gzip && typeof DecompressionStream !== "undefined";
      const chunkPath = compressed && chunk.gzip ? chunk.gzip : chunk.url;
      const targetUrl = resolveAtlasUrl(chunkPath);

      const response = await fetch(targetUrl, { signal: abort.signal });
      const buffer = await decodeModelResponse(response, chunk.bytes, compressed);
      if (disposed) return;

      const groups = new Map<string, THREE.BufferGeometry[]>();
      atlas.parts.forEach((p, i) => {
        if (p.chunk !== ci) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffer, p.positions, p.vertexCount * 3), 3));
        g.setAttribute("normal", new THREE.BufferAttribute(new Int16Array(buffer, p.normals, p.vertexCount * 3), 3, true));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, p.indices, p.indexCount), 1));
        g.boundingBox = bounds[i].clone();
        g.computeBoundingSphere();

        const pick = new THREE.Mesh(g);
        pick.matrixAutoUpdate = false;
        pickers[i] = pick;
        geometries.push(g);

        g.setAttribute("partIndex", new THREE.BufferAttribute(new Float32Array(p.vertexCount).fill(i), 1));
        const matKey = resolveMaterialKey(p);
        const list = groups.get(matKey) ?? [];
        list.push(g);
        groups.set(matKey, list);
      });

      groups.forEach((gs, matKey) => {
        const geometry = mergeGeometries(gs, false);
        if (!geometry) return;
        geometries.push(geometry);
        const mat = mats.get(matKey) ?? mats.get("skeletal");
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.frustumCulled = false;
        scene.add(mesh);
      });

      lastState = null;
      loadedChunks++;
      const progressPct = Math.round((loadedChunks / atlas.chunks.length) * 100);
      setLoadingProgress(progressPct);
      dirty = true;
    };

    // 3개 병렬 워커로 15개 청크 스트리밍 다운로드
    (async () => {
      try {
        let cursor = 0;
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            while (cursor < atlas.chunks.length) {
              const i = cursor++;
              await loadChunk(i);
            }
          }),
        );
        if (!disposed) {
          ready = true;
          dirty = true;
        }
      } catch (e) {
        if (!disposed) {
          setLoadError(e instanceof Error ? e.message : "3D 데이터를 불러오는 중 오류가 발생했습니다.");
        }
      }
    })();

    const fit = (view: string, extent = 0) => {
      const mobile = el.clientWidth < 768;
      const normalDistance = mobile ? 4.5 : 3.8;
      const distance = THREE.MathUtils.lerp(normalDistance, 5.0, extent);
      if (extent > 0.8) view = "front";

      const direction =
        view === "front"
          ? new THREE.Vector3(0, 0.02, 1)
          : view === "back"
          ? new THREE.Vector3(0, 0.02, -1)
          : view === "side"
          ? new THREE.Vector3(1, 0.02, 0)
          : new THREE.Vector3(0.35, 0.06, 1).normalize();

      controls.target.set(0, mobile ? 0.85 : 0.72, 0);
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      controls.update();
      dirty = true;
    };

    const resize = () => {
      layoutKey = "";
      lastState = null;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, el.clientWidth < 768 ? 1.5 : 2));
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      fit(latestState.current.view, amount);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // 레이캐스팅 및 픽킹
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const tap = new PointerTap();
    const worldBox = new THREE.Box3();
    const hitPoint = new THREE.Vector3();

    const onPointerDown = (e: PointerEvent) => {
      tap.down(e.pointerId, e.clientX, e.clientY, e.pointerType === "touch" ? 12 : 5);
    };

    const onPointerMove = (e: PointerEvent) => {
      tap.move(e.pointerId, e.clientX, e.clientY);
      if (!ready || e.buttons) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      let nearest = Infinity;
      let foundIndex = -1;
      const hasSolid = atlas.parts.some((p, i) => p.system !== "integumentary" && data[i * 4 + 3] > 0.5);

      pickers.forEach((mesh, i) => {
        if (!mesh || data[i * 4 + 3] < 0.5 || (hasSolid && atlas.parts[i].system === "integumentary")) return;
        worldBox.copy(bounds[i]).translate(mesh.position);
        if (!raycaster.ray.intersectBox(worldBox, hitPoint)) return;
        const hits = raycaster.intersectObject(mesh, false);
        if (hits[0] && hits[0].distance < nearest) {
          nearest = hits[0].distance;
          foundIndex = i;
        }
      });

      if (foundIndex >= 0) {
        setHoveredPart(atlas.parts[foundIndex]);
        renderer.domElement.style.cursor = "pointer";
      } else {
        setHoveredPart(null);
        renderer.domElement.style.cursor = "grab";
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const validTap = tap.up(e.pointerId, e.clientX, e.clientY);
      if (!validTap || !ready) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      let nearest = Infinity;
      let foundIndex = -1;
      const hasSolid = atlas.parts.some((p, i) => p.system !== "integumentary" && data[i * 4 + 3] > 0.5);

      pickers.forEach((mesh, i) => {
        if (!mesh || data[i * 4 + 3] < 0.5 || (hasSolid && atlas.parts[i].system === "integumentary")) return;
        worldBox.copy(bounds[i]).translate(mesh.position);
        if (!raycaster.ray.intersectBox(worldBox, hitPoint)) return;
        const hits = raycaster.intersectObject(mesh, false);
        if (hits[0] && hits[0].distance < nearest) {
          nearest = hits[0].distance;
          foundIndex = i;
        }
      });

      if (foundIndex >= 0) {
        const p = atlas.parts[foundIndex];
        setSelectedPart(p);
        setSceneState((prev) => ({
          ...prev,
          selected: [p.id],
        }));
        if (onSelectPartRef.current) {
          const sysDef = SYSTEMS.find((s) => s.id === p.system);
          onSelectPartRef.current(p.name, sysDef ? sysDef.nameKo : p.system);
        }
      } else {
        setSelectedPart(null);
        setSceneState((prev) => ({
          ...prev,
          selected: [],
        }));
      }
      dirty = true;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);

    // 렌더 루프
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (disposed) return;

      const curState = latestState.current;
      if (curState.rotate) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.2;
        dirty = true;
      } else {
        controls.autoRotate = false;
      }

      if (controls.update()) dirty = true;

      // 뷰 리셋 또는 전환 감지
      if (curState.view !== lastView || curState.reset !== lastReset) {
        lastView = curState.view;
        lastReset = curState.reset;
        fit(curState.view, curState.explode);
      }

      // 상태 변경 시 셰이더 DataTexture 갱신
      if (curState !== lastState) {
        const visibleSystems = new Set(curState.visible);
        const selectedIds = new Set(curState.selected);

        // 분해 레이아웃 갱신
        const nextLayoutKey = `${curState.visible.sort().join(",")}:${el.clientWidth}:${el.clientHeight}`;
        if (nextLayoutKey !== layoutKey) {
          layoutKey = nextLayoutKey;
          const activeParts = atlas.parts.filter((p) => visibleSystems.has(p.system));
          const layout = createExplosionLayout(activeParts, el.clientWidth / el.clientHeight);
          atlas.parts.forEach((p, i) => {
            const cell = layout.cells.get(p.id);
            if (cell) {
              offsets[i] = new THREE.Vector3(cell.x - centers[i].x, cell.y - centers[i].y, -centers[i].z);
            } else {
              offsets[i] = new THREE.Vector3();
            }
          });
        }

        amount = curState.explode;
        atlas.parts.forEach((p, i) => {
          const isVis = visibleSystems.has(p.system) || selectedIds.has(p.id);
          const isSel = selectedIds.has(p.id);

          const off = offsets[i] ?? new THREE.Vector3();
          data[i * 4 + 0] = off.x * amount;
          data[i * 4 + 1] = off.y * amount;
          data[i * 4 + 2] = off.z * amount;
          data[i * 4 + 3] = isVis ? 1 : 0;

          selectedData[i * 4 + 0] = isSel ? 255 : 0;
          selectedData[i * 4 + 1] = 0;
          selectedData[i * 4 + 2] = 0;
          selectedData[i * 4 + 3] = isSel ? 255 : 0;

          if (pickers[i]) {
            pickers[i]!.position.set(off.x * amount, off.y * amount, off.z * amount);
          }
        });

        partTexture.needsUpdate = true;
        selectionTexture.needsUpdate = true;
        lastState = curState;
        dirty = true;
      }

      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      abort.abort();
      observer.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      partTexture.dispose();
      selectionTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [atlas]);

  const toggleSystem = (id: SystemId) => {
    setSceneState((prev) => {
      const next = prev.visible.includes(id)
        ? prev.visible.filter((s) => s !== id)
        : [...prev.visible, id];
      return { ...prev, visible: next };
    });
  };

  const handleSelectAllSystems = () => {
    setSceneState((prev) => ({
      ...prev,
      visible: SYSTEMS.map((s) => s.id),
    }));
  };

  const handleDeselectAllSystems = () => {
    setSceneState((prev) => ({
      ...prev,
      visible: [],
    }));
  };

  const resetView = () => {
    setSceneState((prev) => ({
      ...prev,
      view: "three-quarter",
      explode: 0,
      visible: DEFAULT_VISIBLE_SYSTEMS,
      selected: [],
      rotate: false,
      reset: prev.reset + 1,
    }));
    setSelectedPart(null);
  };

  return (
    <div
      className="human-atlas-container"
      style={{
        display: "flex",
        width: "100%",
        height: "620px",
        background: "#090d16",
        borderRadius: "16px",
        overflow: "hidden",
        position: "relative",
        color: "#f8fafc",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* 3D 렌더링 캔버스 영역 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          height: "100%",
          position: "relative",
          cursor: "grab",
        }}
      >
        {/* 상단 헤더 배지 & 로딩 인디케이터 */}
        <div
          style={{
            position: "absolute",
            top: "14px",
            left: "16px",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: loadingProgress < 100 ? "#f59e0b" : "#10b981",
                boxShadow: loadingProgress < 100 ? "0 0 10px #f59e0b" : "0 0 10px #10b981",
              }}
            />
            <span style={{ fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8" }}>
              BODYPARTS3D 아틀라스
            </span>
            <span
              style={{
                fontSize: "0.68rem",
                padding: "2px 6px",
                borderRadius: "4px",
                background: "rgba(56, 189, 248, 0.15)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.3)",
              }}
            >
              2,234 메쉬 전체
            </span>
          </div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, marginTop: "4px", color: "#f1f5f9" }}>
            Human Atlas (Full Pieces)
          </div>
        </div>

        {/* 로딩 프로그레스 바 */}
        {loadingProgress < 100 && (
          <div
            style={{
              position: "absolute",
              top: "68px",
              left: "16px",
              background: "rgba(15, 23, 42, 0.85)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              backdropFilter: "blur(8px)",
              padding: "8px 14px",
              borderRadius: "8px",
              zIndex: 10,
              fontSize: "0.78rem",
              color: "#cbd5e1",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span>전신 2,234 파츠 로딩 중 ({loadingProgress}%)</span>
            <div
              style={{
                width: "80px",
                height: "4px",
                background: "#334155",
                borderRadius: "2px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${loadingProgress}%`,
                  height: "100%",
                  background: "#38bdf8",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        )}

        {loadError && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(225, 29, 72, 0.9)",
              color: "#fff",
              padding: "16px 24px",
              borderRadius: "8px",
              zIndex: 20,
            }}
          >
            {loadError}
          </div>
        )}

        {/* 선택 및 호버 인스펙터 툴팁 */}
        {(selectedPart || hoveredPart) && (
          <div
            style={{
              position: "absolute",
              bottom: "74px",
              left: "16px",
              background: "rgba(15, 23, 42, 0.9)",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              backdropFilter: "blur(12px)",
              padding: "10px 14px",
              borderRadius: "10px",
              zIndex: 10,
              maxWidth: "320px",
              boxShadow: "0 8px 20px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: SYSTEMS.find((s) => s.id === (selectedPart || hoveredPart)?.system)?.color,
                }}
              />
              <span style={{ fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600 }}>
                {SYSTEMS.find((s) => s.id === (selectedPart || hoveredPart)?.system)?.nameKo}
              </span>
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f8fafc", marginTop: "4px" }}>
              {(selectedPart || hoveredPart)?.name}
            </div>
            {selectedPart?.name.toLowerCase().includes("ear") && (
              <span style={{ fontSize: "0.72rem", color: "#38bdf8", marginTop: "2px", display: "block" }}>
                ★ 원본 BodyParts3D에 포함된 독립 외이(귓바퀴) 구조입니다.
              </span>
            )}
          </div>
        )}

        {/* 뷰 앵글 & 회전 컨트롤 독 */}
        <div
          style={{
            position: "absolute",
            top: "14px",
            right: "16px",
            display: "flex",
            gap: "4px",
            background: "rgba(15, 23, 42, 0.8)",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            zIndex: 10,
          }}
        >
          {(["three-quarter", "front", "side", "back"] as HumanAtlasView[]).map((v, i) => (
            <button
              key={v}
              type="button"
              onClick={() => setSceneState((s) => ({ ...s, view: v, reset: s.reset + 1, rotate: false }))}
              style={{
                background: sceneState.view === v ? "rgba(56, 189, 248, 0.2)" : "transparent",
                color: sceneState.view === v ? "#38bdf8" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "0.74rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {["¾", "정면", "측면", "후면"][i]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSceneState((s) => ({ ...s, rotate: !s.rotate }))}
            style={{
              background: sceneState.rotate ? "rgba(56, 189, 248, 0.2)" : "transparent",
              color: sceneState.rotate ? "#38bdf8" : "#94a3b8",
              border: "none",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "0.74rem",
              cursor: "pointer",
            }}
            title="자동 회전 토글"
          >
            {sceneState.rotate ? "일시정지" : "회전"}
          </button>
          <button
            type="button"
            onClick={resetView}
            style={{
              background: "transparent",
              color: "#94a3b8",
              border: "none",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "0.74rem",
              cursor: "pointer",
            }}
            title="시점 및 레이어 리셋"
          >
            리셋
          </button>
        </div>

        {/* 하단 Explode (분해 전개도) 슬라이더 컨트롤 */}
        <div
          style={{
            position: "absolute",
            bottom: "16px",
            left: "16px",
            right: "16px",
            background: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: "10px",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            zIndex: 10,
          }}
        >
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#cbd5e1", whiteSpace: "nowrap" }}>
            파츠 분해 전개도: {Math.round(sceneState.explode * 100)}%
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={sceneState.explode * 100}
            onChange={(e) => {
              const val = Number(e.target.value) / 100;
              setSceneState((s) => ({
                ...s,
                explode: val,
                view: val > 0.8 ? "front" : s.view,
                rotate: false,
              }));
            }}
            style={{
              flex: 1,
              accentColor: "#38bdf8",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: "0.7rem", color: "#64748b", whiteSpace: "nowrap" }}>
            {sceneState.explode === 0 ? "인체 결합 상태" : "2,234 조각 전개"}
          </span>
        </div>
      </div>

      {/* 우측 사이드바: 15개 시스템 레이어 필터 */}
      <aside
        style={{
          width: "220px",
          background: "#0b1120",
          borderLeft: "1px solid rgba(148, 163, 184, 0.15)",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#e2e8f0" }}>해부학 계통 (15)</span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={handleSelectAllSystems}
              style={{
                fontSize: "0.68rem",
                padding: "2px 5px",
                background: "rgba(56, 189, 248, 0.1)",
                color: "#38bdf8",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              전체
            </button>
            <button
              type="button"
              onClick={handleDeselectAllSystems}
              style={{
                fontSize: "0.68rem",
                padding: "2px 5px",
                background: "rgba(148, 163, 184, 0.1)",
                color: "#94a3b8",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              해제
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {SYSTEMS.map((sys) => {
            const isVisible = sceneState.visible.includes(sys.id);
            const count = atlas?.parts.filter((p) => p.system === sys.id).length ?? 0;
            return (
              <button
                key={sys.id}
                type="button"
                onClick={() => toggleSystem(sys.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  background: isVisible ? "rgba(30, 41, 59, 0.7)" : "transparent",
                  border: isVisible ? "1px solid rgba(148, 163, 184, 0.2)" : "1px solid transparent",
                  color: isVisible ? "#f1f5f9" : "#64748b",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: sys.color,
                      opacity: isVisible ? 1 : 0.3,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "0.76rem", fontWeight: isVisible ? 600 : 400 }}>
                    {sys.nameKo}
                  </span>
                </div>
                {count > 0 && (
                  <span style={{ fontSize: "0.68rem", color: isVisible ? "#94a3b8" : "#475569" }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
