export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data: T;
  meta: Record<string, unknown>;
  error: ApiError | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** What list services return; the response interceptor lifts it into { data, meta, error }. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}
