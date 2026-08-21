import { create } from "zustand";

interface UiState {
  navigationOpen: boolean;
  toggleNavigation: () => void;
  closeNavigation: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  navigationOpen: false,
  toggleNavigation: () => set((state) => ({ navigationOpen: !state.navigationOpen })),
  closeNavigation: () => set({ navigationOpen: false }),
}));
