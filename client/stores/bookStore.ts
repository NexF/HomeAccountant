import { create } from 'zustand';
import { bookService, type BookResponse } from '@/services/bookService';

type BookState = {
  books: BookResponse[];
  currentBook: BookResponse | null;
  isLoading: boolean;

  fetchBooks: () => Promise<void>;
  setCurrentBook: (book: BookResponse) => void;
  reset: () => void;
};

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBook: null,
  isLoading: false,

  fetchBooks: async () => {
    set({ isLoading: true });
    try {
      const { data } = await bookService.getBooks();
      const current = get().currentBook;
      set({
        books: data,
        // 如果还没有当前账本或当前账本已被删除，选第一个
        currentBook: current && data.find((b) => b.id === current.id)
          ? current
          : data[0] ?? null,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  setCurrentBook: (book) => set({ currentBook: book }),

  reset: () => set({ books: [], currentBook: null, isLoading: false }),
}));
