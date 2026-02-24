import api from './api';

export type BookResponse = {
  id: string;
  name: string;
  type: string;
  owner_id: string;
  created_at: string;
  role: string;
};

export type BookMemberResponse = {
  user_id: string;
  email: string;
  nickname: string | null;
  role: string;
  is_owner: boolean;
};

export type CreateBookParams = {
  name: string;
  type?: 'personal' | 'family';
};

export type UpdateBookParams = {
  name: string;
};

export type InviteMemberParams = {
  email: string;
  role?: 'admin' | 'member';
};

export type UpdateMemberRoleParams = {
  role: 'admin' | 'member';
};

export const bookService = {
  // 账本 CRUD
  getBooks: () => api.get<BookResponse[]>('/books'),

  createBook: (params: CreateBookParams) =>
    api.post<BookResponse>('/books', params),

  updateBook: (bookId: string, params: UpdateBookParams) =>
    api.put<BookResponse>(`/books/${bookId}`, params),

  deleteBook: (bookId: string) =>
    api.delete(`/books/${bookId}`),

  // 成员管理
  getMembers: (bookId: string) =>
    api.get<BookMemberResponse[]>(`/books/${bookId}/members`),

  inviteMember: (bookId: string, params: InviteMemberParams) =>
    api.post<BookMemberResponse>(`/books/${bookId}/members`, params),

  updateMemberRole: (bookId: string, userId: string, params: UpdateMemberRoleParams) =>
    api.put<BookMemberResponse>(`/books/${bookId}/members/${userId}`, params),

  removeMember: (bookId: string, userId: string) =>
    api.delete(`/books/${bookId}/members/${userId}`),

  leaveBook: (bookId: string) =>
    api.post(`/books/${bookId}/leave`),
};
