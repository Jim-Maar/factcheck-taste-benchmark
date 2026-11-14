import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FieldDef } from "@cn/core/fieldQuery";
import { fetchNoteFacets, fetchNotePage, fetchNoteSummary, NOTE_PAGE_SIZE, type NoteCursor, type NoteRequest, type PagedCard, type Source } from "@cn/core/taste";
import type { Facet } from "@cn/features/fieldQuery/Filters";
import { queryKeys } from "@cn/features/query/queryKeys";
import { usePagedList } from "@cn/features/query/usePagedList";
import { VALUE_NAMES } from "./noteFields";

/* The reads of a tab, as TanStack Query hooks. A changed filter keeps the old
 * counts on screen until the new ones arrive, so they do not flash empty.
 * Adapted from the X notewriter page of commonnotes.net. */

/** A moment that stays fixed until `key` changes. Date filters count back
 *  from it. Copied from commonnotes.net's feed queries. */
export function useMomentFor(key: string): Date {
  const [moment, setMoment] = useState({ key, at: new Date() });
  // Taking a new moment during render is React's pattern for state derived
  // from props: React re-renders straight away with the new moment.
  if (moment.key !== key) setMoment({ key, at: new Date() });
  return moment.key === key ? moment.at : new Date();
}

export const useNoteSummary = (source: Source, request: NoteRequest) =>
  useQuery({ queryKey: queryKeys.summary(source, request), queryFn: () => fetchNoteSummary(source, request), placeholderData: (previous) => previous });

/** The display name of a value that comes from the data. */
function valueName(field: string, value: string, label: string | null): string | null {
  if (label) return label;
  if (value === "none") return "None";
  return VALUE_NAMES[field]?.(value) ?? null;
}

/** How many notes each value of the choice fields would show, for the Filter
 *  menu. */
export function useNoteFacets(source: Source, fields: readonly FieldDef[], request: NoteRequest): Record<string, Facet[]> | undefined {
  const facets = fields.flatMap((field) => (field.kind === "choice" ? [{ column: field.id, labelColumn: field.labelColumn }] : []));
  return useQuery({
    queryKey: queryKeys.facets(source, facets.map((facet) => facet.column), request),
    queryFn: async () => {
      const byField = await fetchNoteFacets(source, request, facets);
      return Object.fromEntries(Object.entries(byField).map(([field, values]) => [field, values.map((v) => ({ value: v.value, label: valueName(field, v.value, v.label), count: v.count }))]));
    },
    placeholderData: (previous) => previous,
  }).data;
}

/** A page shorter than a full page is the list's last. */
const nextCursor = (page: PagedCard<Source>[]): NoteCursor | undefined => {
  const last = page.at(-1);
  return page.length === NOTE_PAGE_SIZE && last ? { key: last.sortKey, id: last.noteId } : undefined;
};

export const useNoteList = <S extends Source>(source: S, request: NoteRequest) =>
  usePagedList({
    queryKey: queryKeys.notes(source, request),
    fetchPage: (cursor: NoteCursor | null) => fetchNotePage(source, request, cursor),
    firstBookmark: null as NoteCursor | null,
    nextBookmark: nextCursor as (page: PagedCard<S>[]) => NoteCursor | undefined,
  });
