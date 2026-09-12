export type UsagePaginationMeta = {
  totalPages: number;
};

export function resolveUsagePagination(
  page: number,
  pagination?: UsagePaginationMeta,
) {
  const requestedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const totalPages = Math.max(1, Math.floor(pagination?.totalPages ?? 1));

  return {
    safePage: pagination ? Math.min(requestedPage, totalPages) : requestedPage,
    totalPages,
  };
}

export function shouldClampUsagePage(
  page: number,
  pagination: UsagePaginationMeta | undefined,
  isFetching: boolean,
) {
  if (!pagination || isFetching) return false;
  return page > Math.max(1, Math.floor(pagination.totalPages));
}
