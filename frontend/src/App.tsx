import { AppProviders } from "./app/AppProviders";

// 기존 가상 프론트 진입점은 유지하되, 화면은 최신 dev의 공용 앱 구조를 사용한다.
export function App() {
  return <AppProviders />;
}
