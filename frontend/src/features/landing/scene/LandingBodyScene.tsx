/**
 * 랜딩페이지의 3D 인체 장면.
 *
 * ## 이 화면이 쓰는 모델은 앱이 쓰는 그 모델이다
 *
 * `/vendor/vanatome` 아틀라스(Z-Anatomy 파생)를 `anatomyAtlas` 의 매니페스트 로더로
 * 받아서 `holographicAnatomyStyle` 의 재질을 그대로 입힌다. 랜딩용 더미 인체를
 * 따로 만들지 않는다 — 랜딩에서 본 몸과 가입 뒤에 만나는 몸이 다르면 그 장면은
 * 광고이지 데모가 아니다.
 *
 * ## 그런데 왜 `VanatomeBodyMap` 을 그대로 쓰지 않나
 *
 * 그쪽은 **앱의 도구**다 — 계통 필터 툴바, 구조 검색, 치아 선택기, 깊이 피킹,
 * 초점별 지연 로드(머리 확대 시 738개 구조 추가)까지 한 몸이고, 프로필과 판정
 * 위험도를 입력으로 받는다. 랜딩에서 필요한 것은 그중 하나도 없고, 오히려
 * "한 장면에 메시지 하나" 를 깨뜨린다. 그래서 **자산과 재질·로더는 공유하고
 * 조작 UI 는 두지 않는** 발표용 장면을 따로 둔다. 앱 쪽 파일은 건드리지 않는다.
 *
 * ## 성능
 *
 * - 핵심 자산 7 MiB 는 **섹션이 화면 가까이 올 때만** 받는다(부모가 `active` 로 판단).
 * - rAF 는 섹션이 보이는 동안에만 돈다. 화면 밖으로 나가면 멈춘다.
 * - 진행도는 ref 로 받는다. 프레임마다 리렌더하지 않는다.
 * - 표식 라벨은 DOM 이지만 위치를 직접 쓴다(state 아님).
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  adaptAnatomyMesh,
  inheritAnatomyMetadata,
  loadAnatomyAtlasManifest,
  loadAnatomyMetadata,
  type AnatomyAtlasAsset,
} from "../../home/anatomyAtlas";
import { fetchCachedAnatomyResource } from "../../home/anatomyResourceCache";
import { createHolographicMaterials, getPainColorProfile } from "../../home/holographicAnatomyStyle";
import { BODY_MARKER_LABEL, BODY_SCENES, type BodyMarkerId } from "../landingStory";
import {
  BODY_MARKER_ANCHORS,
  MODEL_FACING_Y,
  MODEL_HEIGHT,
  cameraAt,
  firstSceneOfMarker,
  idleSpin,
  markerReveal,
} from "./bodyScene";

const ASSET_TIMEOUT_MS = 45_000;

/**
 * 표식 색. 앱의 통증 팔레트에서 **한 단계만** 가져다 쓴다(보통, 5점).
 * 부위마다 색을 달리하면 세 점이 서로 다른 뜻으로 읽히는데, 이 장면이 말하는 것은
 * "기록이 남는다" 하나다. 빨강(극심)은 쓰지 않는다 — 위험 경고가 아니다.
 */
const MARKER_INTENSITY = 5;

interface LandingBodySceneProps {
  /** true 가 되는 순간 자산을 받기 시작한다. 한 번 켜지면 계속 켜져 있다. */
  active: boolean;
  /**
   * 섹션이 지금 화면에 걸쳐 있는가. **렌더 루프의 on/off 스위치다.**
   *
   * 처음에는 `active` 하나로만 돌렸는데, 그 값은 한 번 켜지면 안 꺼져서
   * 인체 섹션을 지나 챌린지·가족·챗봇을 보는 내내 WebGL 이 60fps 로 계속
   * 그리고 있었다 — 페이지 아래쪽 전체가 눈에 띄게 버벅였다(실측).
   * 자산은 그대로 두고 **그리기만** 멈춘다. 다시 들어오면 즉시 이어 그린다.
   */
  visible: boolean;
  /** 0~1 진행도. 프레임마다 읽는다. */
  progressRef: React.RefObject<number>;
  /** 모션 축소. 자동 회전과 카메라 이동을 멈추고 마지막 장면 구도로 고정한다. */
  reducedMotion: boolean;
  onLoadingChange?: (state: { loading: boolean; percent: number }) => void;
  /** WebGL 이 없거나 자산을 못 받았을 때. 부모가 대체 화면을 세운다. */
  onFailure?: (reason: string) => void;
  /**
   * 표식 색. **주지 않으면 앱의 통증 팔레트(보통, 5점)** 를 쓴다 — v1 랜딩이
   * 그 값으로 서 있으므로 기본값을 바꾸지 않는다.
   *
   * v2 랜딩은 배경이 검정이 아니라 딥 오버진이라 그 위에서 통증 팔레트의 주황이
   * 따로 떠 보인다(보색에 가깝다). 같은 장면을 두 벌 복사하는 대신 **색 하나만**
   * 밖에서 받는다 — 장면의 판단(무엇이 언제 드러나는가)은 여전히 한 곳에 있다.
   */
  markerColor?: string;
}

const MARKER_IDS = Object.keys(BODY_MARKER_ANCHORS) as BodyMarkerId[];

/** 표식용 원형 글로우 텍스처. 이미지 파일을 더하지 않고 캔버스로 그린다. */
function createGlowTexture(color: THREE.Color): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const css = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;
    gradient.addColorStop(0, `rgba(${css}, 0.95)`);
    gradient.addColorStop(0.35, `rgba(${css}, 0.45)`);
    gradient.addColorStop(1, `rgba(${css}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function LandingBodyScene({
  active,
  visible,
  progressRef,
  reducedMotion,
  onLoadingChange,
  onFailure,
  markerColor,
}: LandingBodySceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<BodyMarkerId, HTMLDivElement | null>());
  /** 장면 효과가 여기에 자기 루프의 스위치를 걸어 둔다. 장면이 없으면 `null`. */
  const loopRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const visibleRef = useRef(visible);
  // 렌더 루프가 읽는 최신 값들. 렌더 중에 쓰지 않고 효과에서 갈아 끼운다
  // (`react-hooks/refs`, `VanatomeBodyMap` 도 같은 모양).
  const reducedMotionRef = useRef(reducedMotion);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    onLoadingChangeRef.current = onLoadingChange;
    onFailureRef.current = onFailure;
  }, [reducedMotion, onLoadingChange, onFailure]);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) loopRef.current?.start();
    else loopRef.current?.stop();
  }, [visible]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    // jsdom 에는 WebGL 이 없다. 단위 테스트에서 캔버스를 만들려다 던지지 않게 한다.
    if (navigator.userAgent.includes("jsdom")) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (error) {
      onFailureRef.current?.(error instanceof Error ? error.message : "WebGL 을 사용할 수 없습니다");
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;
    let disposed = false;
    let frame = 0;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.05, 4.1);

    // 앱의 인체 뷰어와 같은 환경광. PBR 재질이 이 환경을 전제로 만들어져 있어서
    // 이것을 빼면 뼈가 회색 플라스틱처럼 보인다.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(2.5, 3.5, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xbcd2ff, 0.9);
    rimLight.position.set(-3, 1.5, -2.5);
    scene.add(rimLight);
    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x0b1020, 0.55));

    const bodyGroup = new THREE.Group();
    scene.add(bodyGroup);

    // 모델만 담는 안쪽 그룹. 원본을 정면으로 돌리고 키를 맞추는 변환이 여기 붙고,
    // 표식은 바깥(`bodyGroup`)에 붙는다 — 표식 좌표는 이미 "정면 +Z · 키 2" 기준이라
    // 같은 변환을 두 번 받으면 안 된다.
    const modelRoot = new THREE.Group();
    modelRoot.rotation.y = MODEL_FACING_Y;
    bodyGroup.add(modelRoot);

    const ownedMaterials = new Set<THREE.Material>();
    const ownedGeometries = new Set<THREE.BufferGeometry>();
    const ownedTextures = new Set<THREE.Texture>();

    /* 표식 ------------------------------------------------------------ */
    const painColor = markerColor
      ? new THREE.Color(markerColor)
      : getPainColorProfile(MARKER_INTENSITY).color.clone();
    const glowTexture = createGlowTexture(painColor);
    ownedTextures.add(glowTexture);

    interface MarkerHandle {
      id: BodyMarkerId;
      appearScene: number;
      group: THREE.Group;
      glow: THREE.Sprite;
      ring: THREE.Mesh;
      /** 바깥을 향하는 방향. 몸 뒤로 돌아갔을 때 라벨을 숨기는 데 쓴다. */
      normal: THREE.Vector3;
    }

    const markers: MarkerHandle[] = [];
    for (const id of MARKER_IDS) {
      const appearScene = firstSceneOfMarker(BODY_SCENES, id);
      if (appearScene === undefined) continue;
      const anchor = BODY_MARKER_ANCHORS[id];
      const group = new THREE.Group();
      group.position.set(anchor[0], anchor[1], anchor[2]);

      const glowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0,
      });
      ownedMaterials.add(glowMaterial);
      const glow = new THREE.Sprite(glowMaterial);
      glow.scale.setScalar(0.34);
      group.add(glow);

      const ringGeometry = new THREE.RingGeometry(0.055, 0.068, 48);
      ownedGeometries.add(ringGeometry);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: painColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      ownedMaterials.add(ringMaterial);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      group.add(ring);

      bodyGroup.add(group);
      markers.push({
        id,
        appearScene,
        group,
        glow,
        ring,
        normal: new THREE.Vector3(anchor[0], 0, anchor[2] || 0.2).normalize(),
      });
    }

    /* 자산 ------------------------------------------------------------ */
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/vendor/three/draco/gltf/");
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const loadAsset = async (asset: AnatomyAtlasAsset) => {
      const timeout = window.setTimeout(() => abortController.abort(), ASSET_TIMEOUT_MS);
      try {
        const response = await fetchCachedAnatomyResource(asset.url, { signal, revision: asset.sha256 });
        if (!response.ok) throw new Error(`해부 자산 요청 실패: ${asset.url}`);
        const buffer = await response.arrayBuffer();
        if (signal.aborted || disposed) throw new DOMException("Aborted", "AbortError");
        const gltf = await gltfLoader.parseAsync(buffer, "");
        return gltf.scene;
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const projected = new THREE.Vector3();
    const markerWorld = new THREE.Vector3();
    const markerNormalWorld = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const startedAt = performance.now();

    const renderFrame = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;

      const progress = reducedMotionRef.current ? 0.95 : (progressRef.current ?? 0);
      const elapsed = (performance.now() - startedAt) / 1000;

      const view = cameraAt(progress);
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      cameraTarget.set(view.target[0], view.target[1], view.target[2]);
      camera.lookAt(cameraTarget);

      bodyGroup.rotation.y = reducedMotionRef.current ? 0 : idleSpin(elapsed, progress);

      // 표식: 드러남 + 아주 느린 맥동. 맥동은 "살아 있다" 정도만이고 경고가 아니다.
      const pulse = reducedMotionRef.current ? 1 : 0.92 + Math.sin(elapsed * 1.6) * 0.08;
      camera.getWorldDirection(cameraDirection);
      for (const marker of markers) {
        const reveal = markerReveal(progress, marker.appearScene, BODY_SCENES.length);
        const glowMaterial = marker.glow.material as THREE.SpriteMaterial;
        const ringMaterial = marker.ring.material as THREE.MeshBasicMaterial;
        // 0.85 는 경고등처럼 셌다. 표식은 "여기 기록이 있다" 지 "위험" 이 아니다.
        glowMaterial.opacity = reveal * 0.6 * pulse;
        ringMaterial.opacity = reveal * 0.85;
        marker.group.visible = reveal > 0.01;
        marker.group.scale.setScalar(0.6 + reveal * 0.4);
        marker.ring.quaternion.copy(camera.quaternion);

        const label = labelRefs.current.get(marker.id);
        if (!label) continue;
        if (reveal <= 0.01) {
          label.style.opacity = "0";
          continue;
        }
        marker.group.getWorldPosition(markerWorld);
        markerNormalWorld.copy(marker.normal).applyQuaternion(bodyGroup.quaternion);
        // 몸 뒤쪽으로 돌아간 표식은 라벨을 접는다. 안 그러면 몸을 뚫고 글자가 뜬다.
        const facing = markerNormalWorld.dot(cameraDirection) < 0 ? 1 : 0;
        projected.copy(markerWorld).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        // 오른쪽 끝에 붙은 표식은 이름표를 왼쪽으로 넘긴다. 좁은 화면에서
        // "왼쪽 어깨" 가 화면 밖으로 잘려 나갔다(375px 실측).
        label.dataset.flip = x > width - 150 ? "true" : "false";
        // 화면 아래쪽은 장면 글과 대화 말풍선의 자리다. 거기로 내려간 이름표는
        // 말풍선 뒤에 반쯤 가려 잘린 조각처럼 보였다 — 겹치기 전에 비켜 준다.
        const bottomFade = y > height - 150 ? Math.max(0, (height - y) / 150) : 1;
        label.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        label.style.opacity = String(reveal * facing * bottomFade);
      }

      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      renderFrame();
    };

    const startLoop = () => {
      if (frame || disposed) return;
      frame = requestAnimationFrame(loop);
    };

    const stopLoop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      // 멈춰 있을 때도 크기가 바뀌면 한 장은 다시 그려야 한다. 안 그리면
      // 화면 밖에서 회전한 기기로 돌아왔을 때 늘어난 그림이 남는다.
      renderFrame();
    });
    resizeObserver.observe(host);

    void (async () => {
      onLoadingChangeRef.current?.({ loading: true, percent: 0 });
      try {
        const manifest = await loadAnatomyAtlasManifest("vanatome-male-reference");
        const metadata = await loadAnatomyMetadata(manifest).catch(() => new Map());
        // 첫 화면 무게를 줄인다 — 외피·골격 본체와 갈비연골만. 계통 지연 로드
        // (머리 738 · 상반신 1,074 구조)는 앱 쪽 뷰어의 일이다.
        const assets = manifest.assets.filter(
          (asset) => asset.visualRole === "atlas" || asset.visualRole === "skeleton",
        );
        for (const [index, asset] of assets.entries()) {
          const model = await loadAsset(asset);
          if (disposed) return;
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            inheritAnatomyMetadata(object);
            const adapted = adaptAnatomyMesh(object, asset, manifest, metadata);
            if (!adapted) {
              object.visible = false;
              return;
            }
            object.material = createHolographicMaterials(
              object.material,
              adapted.visualRole,
              adapted.system,
              ownedMaterials,
              0.78,
              object.name,
            );
            object.castShadow = false;
            object.receiveShadow = false;
          });
          modelRoot.add(model);
          onLoadingChangeRef.current?.({
            loading: true,
            percent: Math.min(96, Math.round(((index + 1) / assets.length) * 100)),
          });
        }
        if (disposed) return;

        // 키 2, 중심 원점으로 맞춘다. `bodyScene.ts` 의 좌표가 전부 이것을 전제한다.
        // 회전을 반영한 뒤에 재야 한다 — 돌리기 전 바운딩 박스로 맞추면 가로세로가
        // 바뀌어 키가 어긋난다.
        modelRoot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        if (size.y > 0) {
          const scale = MODEL_HEIGHT / size.y;
          modelRoot.scale.setScalar(scale);
          modelRoot.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        }

        onLoadingChangeRef.current?.({ loading: false, percent: 100 });
        resize();
        loopRef.current = { start: startLoop, stop: stopLoop };
        // 다 받았을 때 이미 화면 밖이라면 한 장만 그려 두고 멈춰 있는다.
        renderFrame();
        if (visibleRef.current) startLoop();
      } catch (error) {
        if (disposed || signal.aborted) return;
        onLoadingChangeRef.current?.({ loading: false, percent: 0 });
        onFailureRef.current?.(error instanceof Error ? error.message : "3D 인체를 불러오지 못했습니다");
      }
    })();

    return () => {
      disposed = true;
      loopRef.current = null;
      abortController.abort();
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      // three 는 GC 가 회수하지 않는 GPU 자원을 들고 있다. 섹션을 벗어날 때마다
      // 쌓이면 탭 하나가 수백 MB 를 문다.
      bodyGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) ownedGeometries.add(object.geometry);
      });
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      environment.dispose();
      pmrem.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
  }, [active, progressRef, markerColor]);

  return (
    <div className="ln-body-canvas" ref={hostRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="ln-body-markers" aria-hidden="true">
        {MARKER_IDS.map((id) => (
          <div
            key={id}
            className="ln-body-marker"
            ref={(node) => {
              labelRefs.current.set(id, node);
            }}
          >
            <span>{BODY_MARKER_LABEL[id]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
