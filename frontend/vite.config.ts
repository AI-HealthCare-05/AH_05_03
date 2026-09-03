import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  build: {
    // **프로덕션 빌드에는 소스맵을 싣지 않는다.**
    //
    // 예전에는 무조건 `true` 라 `dist` 에 `.map` 4.7MB 가 같이 나갔고
    // (`VanatomeBodyMap...js.map` 3.0MB + `index...js.map` 1.7MB) 그게 그대로
    // 서빙 이미지의 `/app/static` 으로 들어갔다. 둘이 걸린다 — 용량도 용량이지만
    // 소스맵은 **원본 TypeScript 를 그대로 복원해 준다.** 누구나 받아 갈 수 있다.
    //
    // 디버깅용으로 필요하면 `npm run build -- --mode development` 로 뽑으면 된다.
    // 배포본에 계속 넣기로 정하면 `"hidden"` 이 절충안이다 — 파일은 만들되
    // `sourceMappingURL` 주석을 안 붙여 브라우저가 자동으로 받지는 않는다.
    sourcemap: mode !== "production",
  },
}));
