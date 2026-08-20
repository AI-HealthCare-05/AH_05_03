import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BODY_REGIONS = [
  { id: "head", label: "머리" },
  { id: "chest", label: "가슴" },
  { id: "abdomen", label: "복부" },
  { id: "left_arm", label: "왼팔" },
  { id: "right_arm", label: "오른팔" },
  { id: "left_leg", label: "왼다리" },
  { id: "right_leg", label: "오른다리" },
] as const;

type BodyRegionId = (typeof BODY_REGIONS)[number]["id"];

const REGION_IDS = new Set<BodyRegionId>(BODY_REGIONS.map((region) => region.id));
const DEFAULT_COLOR = new THREE.Color(0x9fb7e8);
const SELECTED_COLOR = new THREE.Color(0x2563eb);

export function ProceduralBodyMap({ profileName }: { profileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const regionMeshesRef = useRef(new Map<BodyRegionId, THREE.Mesh>());
  const renderSceneRef = useRef<() => void>(() => undefined);
  const [selectedRegionId, setSelectedRegionId] = useState<BodyRegionId>("chest");
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const selectedRegion = BODY_REGIONS.find((region) => region.id === selectedRegionId) ?? BODY_REGIONS[1];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || navigator.userAgent.includes("jsdom")) return;
    const regionMeshes = new Map<BodyRegionId, THREE.Mesh>();
    regionMeshesRef.current = regionMeshes;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      let active = true;
      queueMicrotask(() => {
        if (active) setWebGlUnavailable(true);
      });
      return () => {
        active = false;
        regionMeshesRef.current = new Map();
      };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6f9ff);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0.4, 7.5);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 5.2;
    controls.maxDistance = 10;
    controls.target.set(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c7df, 2.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const body = new THREE.Group();
    scene.add(body);

    function addRegion(
      id: BodyRegionId,
      geometry: THREE.BufferGeometry,
      position: [number, number, number],
      scale: [number, number, number] = [1, 1, 1],
      rotationZ = 0,
    ) {
      const material = new THREE.MeshStandardMaterial({
        color: id === "chest" ? SELECTED_COLOR : DEFAULT_COLOR,
        emissive: id === "chest" ? 0x0c2f73 : 0x000000,
        emissiveIntensity: id === "chest" ? 0.18 : 0,
        roughness: 0.72,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.rotation.z = rotationZ;
      mesh.userData.bodyRegionId = id;
      body.add(mesh);
      regionMeshes.set(id, mesh);
    }

    addRegion("head", new THREE.SphereGeometry(0.43, 32, 24), [0, 2.25, 0]);
    addRegion("chest", new THREE.SphereGeometry(0.72, 32, 24), [0, 1.15, 0], [1, 1.2, 0.68]);
    addRegion("abdomen", new THREE.SphereGeometry(0.58, 32, 24), [0, 0.05, 0], [1, 1.15, 0.7]);
    addRegion("left_arm", new THREE.CapsuleGeometry(0.18, 1.35, 8, 16), [-0.94, 0.95, 0], [1, 1, 1], -0.08);
    addRegion("right_arm", new THREE.CapsuleGeometry(0.18, 1.35, 8, 16), [0.94, 0.95, 0], [1, 1, 1], 0.08);
    addRegion("left_leg", new THREE.CapsuleGeometry(0.23, 1.55, 8, 16), [-0.34, -1.35, 0]);
    addRegion("right_leg", new THREE.CapsuleGeometry(0.23, 1.55, 8, 16), [0.34, -1.35, 0]);

    const base = new THREE.Mesh(
      new THREE.CircleGeometry(1.65, 48),
      new THREE.MeshBasicMaterial({ color: 0xe5edfb, transparent: true, opacity: 0.72 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -2.45;
    scene.add(base);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | undefined;

    const renderScene = () => renderer.render(scene, camera);
    renderSceneRef.current = renderScene;

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
      const hit = raycaster.intersectObjects([...regionMeshes.values()], false)[0];
      const regionId = hit?.object.userData.bodyRegionId;
      if (typeof regionId === "string" && REGION_IDS.has(regionId as BodyRegionId)) {
        setSelectedRegionId(regionId as BodyRegionId);
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    resize();

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      controls.removeEventListener("change", renderScene);
      controls.dispose();
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      regionMeshes.clear();
      regionMeshesRef.current = new Map();
      renderSceneRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    regionMeshesRef.current.forEach((mesh, regionId) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const selected = regionId === selectedRegionId;
      material.color.copy(selected ? SELECTED_COLOR : DEFAULT_COLOR);
      material.emissive.setHex(selected ? 0x0c2f73 : 0x000000);
      material.emissiveIntensity = selected ? 0.18 : 0;
    });
    renderSceneRef.current();
  }, [selectedRegionId]);

  return (
    <section className="body-map-card" aria-labelledby="body-map-title">
      <div className="body-map-copy">
        <p className="section-kicker">기록 위치 미리보기</p>
        <h3 id="body-map-title">{profileName}님의 3D 인체</h3>
        <p>인체를 돌려보거나 부위를 선택해 보세요. 현재는 상호작용을 검증하는 합성 샘플입니다.</p>
        <div className="body-region-buttons" aria-label="신체 부위 선택">
          {BODY_REGIONS.map((region) => (
            <button
              key={region.id}
              type="button"
              aria-pressed={region.id === selectedRegionId}
              onClick={() => setSelectedRegionId(region.id)}
            >
              {region.label}
            </button>
          ))}
        </div>
        <div className="body-map-selection" aria-live="polite">
          <span>선택한 부위</span>
          <strong>{selectedRegion.label}</strong>
          <small>아직 건강기록이나 의료 판정과 연결하지 않았습니다.</small>
        </div>
      </div>
      <div className="body-map-viewer">
        {webGlUnavailable ? (
          <p className="body-map-fallback">이 브라우저에서는 3D를 표시할 수 없습니다. 왼쪽 부위 목록을 이용하세요.</p>
        ) : null}
        <canvas
          ref={canvasRef}
          aria-label={`${profileName}님의 회전 가능한 3D 인체 미리보기`}
        />
        <span className="body-map-hint">드래그하여 회전 · 휠로 확대</span>
      </div>
    </section>
  );
}
