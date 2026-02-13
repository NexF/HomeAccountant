import { create } from 'zustand';

type ProfileNavStore = {
  pendingPane: string | null;
  navigateTo: (pane: string) => void;
  consume: () => string | null;
};

export const useProfileNavStore = create<ProfileNavStore>((set, get) => ({
  pendingPane: null,
  navigateTo: (pane) => set({ pendingPane: pane }),
  consume: () => {
    const pane = get().pendingPane;
    if (pane) set({ pendingPane: null });
    return pane;
  },
}));
