import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { bookService, type BookResponse } from '@/services/bookService';

const STORAGE_KEY = 'selected_book_id';

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
      const savedId = current?.id ?? (await AsyncStorage.getItem(STORAGE_KEY));
      const matched = savedId ? data.find((b) => b.id === savedId) : null;
      const selectedBook = matched ?? data[0] ?? null;
      if (selectedBook) AsyncStorage.setItem(STORAGE_KEY, selectedBook.id);
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
    AsyncStorage.setItem(STORAGE_KEY, book.id);
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

  reset: () => {
    AsyncStorage.removeItem(STORAGE_KEY);
    set({ books: [], currentBook: null, currentRole: null, isLoading: false });
  },
}));
