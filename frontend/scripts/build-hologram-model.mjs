import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DEFAULT_SYSTEMS = new Set([
  "cardiovascular",
  "digestive",
  "endocrine",
  "respiratory",
  "skeletal",
  "urinary",
]);

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error("Usage: node scripts/build-hologram-model.mjs <full-body.glb> <hologram-core.glb>");
  process.exit(1);
}

class NodeFileReader {
  result = null;
  onloadend = null;
  onerror = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer()
      .then((value) => {
        this.result = value;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob) {
    blob.arrayBuffer()
      .then((value) => {
        this.result = `data:${blob.type};base64,${Buffer.from(value).toString("base64")}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

globalThis.FileReader = NodeFileReader;

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const source = await readFile(inputPath);
const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const gltf = await new GLTFLoader().parseAsync(sourceBuffer, "");

let keptMeshes = 0;
let removedMeshes = 0;
gltf.scene.traverse((object) => {
  if (!object.isMesh) return;
  const anatomyId = String(object.userData.anatomyId ?? "");
  const anatomySystem = String(object.userData.anatomySystem ?? "regional-anatomy");
  object.visible = anatomyId === "body-shell" || DEFAULT_SYSTEMS.has(anatomySystem);
  if (object.visible) keptMeshes += 1;
  else removedMeshes += 1;
});

const exported = await new GLTFExporter().parseAsync(gltf.scene, {
  binary: true,
  onlyVisible: true,
});
if (!(exported instanceof ArrayBuffer)) throw new Error("Expected a binary GLB export");
await writeFile(outputPath, Buffer.from(exported));

console.log(JSON.stringify({
  inputBytes: source.byteLength,
  outputBytes: exported.byteLength,
  keptMeshes,
  removedMeshes,
}, null, 2));
