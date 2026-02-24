import { create } from 'zustand';
import { bookService, type BookResponse } from '@/services/bookService';

type BookState = {
  books: BookResponse[];
  currentBook: BookResponse | null;
  currentRole: 'admin' | 'member' | null;
  isLoading: boolean;

  fetchBooks: () => Promise<void>;
  setCurrentBook: (book: BookResponse) => void;
  createBook: (name: string, type: string) => Promise<BookResponse>;
  updateBook: (bookId: string, name: string) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  reset: () => void;
};

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBook: null,
  currentRole: null,
  isLoading: false,

  fetchBooks: async () => {
    set({ isLoading: true });
    try {
      const { data } = await bookService.getBooks();
      const current = get().currentBook;
      const matched = current ? data.find((b) => b.id === current.id) : null;
      const selectedBook = matched ?? data[0] ?? null;
      set({
        books: data,
        currentBook: selectedBook,
        currentRole: (selectedBook?.role as 'admin' | 'member') ?? null,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  setCurrentBook: (book) => {
    set({
      currentBook: book,
      currentRole: (book.role as 'admin' | 'member') ?? null,
    });
  },

  createBook: async (name, type) => {
    const { data } = await bookService.createBook({ name, type });
    await get().fetchBooks();
    return data;
  },

  updateBook: async (bookId, name) => {
    await bookService.updateBook(bookId, { name });
    await get().fetchBooks();
  },

  deleteBook: async (bookId) => {
    await bookService.deleteBook(bookId);
    await get().fetchBooks();
  },

  reset: () => set({ books: [], currentBook: null, currentRole: null, isLoading: false }),
}));
