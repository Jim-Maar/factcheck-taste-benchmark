/** Every key under which server data sits in the query cache. A key is the
 *  address of one cached answer. Keys that share a prefix can be refreshed
 *  together. */
export const queryKeys = {
  /** The loaded pages of one tab's list, under one request. */
  notes: (source: string, request?: unknown) => (request === undefined ? ["notes", source] : ["notes", source, request]) as readonly unknown[],
  /** The count line above a list. */
  summary: (source: string, request?: unknown) => (request === undefined ? ["summary", source] : ["summary", source, request]) as readonly unknown[],
  /** The counts in the Filter menu. */
  facets: (source: string, columns?: string[], request?: unknown) => (columns === undefined ? ["facets", source] : ["facets", source, columns, request]) as readonly unknown[],
  labels: ["labels"] as const,
  sourceDetails: (noteId: string) => ["sourceDetails", noteId] as const,
};
