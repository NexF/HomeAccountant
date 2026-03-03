import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'privacy_hide_amounts';

type PrivacyState = {
  hideAmounts: boolean;
  hydrated: boolean;
  toggleHideAmounts: () => void;
  loadPrivacySetting: () => Promise<void>;
};

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  hideAmounts: false,
  hydrated: false,

  toggleHideAmounts: () => {
    const next = !get().hideAmounts;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ hideAmounts: next });
  },

  loadPrivacySetting: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        set({ hideAmounts: JSON.parse(raw), hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },
}));
