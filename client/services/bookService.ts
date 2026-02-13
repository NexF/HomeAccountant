import api from './api';

export type BookResponse = {
  id: string;
  name: string;
  type: string;
  owner_id: string;
  created_at: string;
};

export type CreateBookParams = {
  name: string;
  type?: 'personal' | 'family';
};

export const bookService = {
  getBooks: () => api.get<BookResponse[]>('/books'),

  createBook: (params: CreateBookParams) =>
    api.post<BookResponse>('/books', params),
};
