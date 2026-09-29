export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
export interface ApiResponse<T> {
    data: T;
    meta?: Record<string, unknown>;
    error?: ApiError;
}
export interface PaginationMeta {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
}
//# sourceMappingURL=dto.d.ts.map