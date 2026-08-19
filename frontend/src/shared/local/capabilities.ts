export interface LocalCapability {
  id: "indexeddb" | "opfs" | "webcrypto" | "persistent-storage";
  label: string;
  supported: boolean;
  requiredNow: boolean;
}

export function detectLocalCapabilities(): LocalCapability[] {
  const storage = navigator.storage;

  return [
    {
      id: "indexeddb",
      label: "IndexedDB 구조화 데이터",
      supported: typeof globalThis.indexedDB !== "undefined",
      requiredNow: true,
    },
    {
      id: "webcrypto",
      label: "Web Crypto 암호화",
      supported: Boolean(globalThis.crypto?.subtle),
      requiredNow: true,
    },
    {
      id: "opfs",
      label: "OPFS 대용량 파일",
      supported: typeof storage?.getDirectory === "function",
      requiredNow: false,
    },
    {
      id: "persistent-storage",
      label: "영구 저장 요청",
      supported: typeof storage?.persist === "function",
      requiredNow: false,
    },
  ];
}
