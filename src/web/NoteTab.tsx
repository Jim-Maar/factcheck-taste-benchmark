import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildRequest, type FieldDef } from "@cn/core/fieldQuery";
import type { NoteCards, NoteRequest, Source } from "@cn/core/taste";
import { FilterButton, FilterPills } from "@cn/features/fieldQuery/Filters";
import { SortBar } from "@cn/features/fieldQuery/SortBar";
import { useFieldQuery } from "@cn/features/fieldQuery/useFieldQuery";
import { useLiveAiReviews } from "@cn/features/notes/useLiveAiReviews";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Input } from "@cn/ui/Field";
import { DEFAULT_QUERY } from "./noteFields";
import { useMomentFor, useNoteFacets, useNoteList, useNoteSummary } from "./queries";

/** How long the search box waits after the last key before it searches. */
const SEARCH_DELAY_MS = 300;
const SEARCH_PARAM = "q";

const formatCount = (n: number) => n.toLocaleString("en-US");

/** The search box's text, kept in the page address so a link shows the same
 *  search. Typing updates the box at once and the search after a pause. */
function useSearch(): [string, string, (text: string) => void] {
  const [text, setText] = useState(() => new URLSearchParams(window.location.search).get(SEARCH_PARAM) ?? "");
  const [search, setSearch] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(text.trim());
      const params = new URLSearchParams(window.location.search);
      if (text.trim()) params.set(SEARCH_PARAM, text.trim());
      else params.delete(SEARCH_PARAM);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return [text, search, setText];
}

function Summary({ source, request }: { source: Source; request: NoteRequest }) {
  const summary = useNoteSummary(source, request);
  if (summary.isError) return <LoadFailed what="The count" onRetry={() => void summary.refetch()} />;
  if (!summary.data) return <p className="text-sm text-fg-muted">Counting…</p>;
  const { notes, judged, tasteFailures } = summary.data;
  return (
    <p className="text-sm text-fg-muted">
      {formatCount(notes)} {notes === 1 ? "note matches" : "notes match"}. {formatCount(judged)} judged, {formatCount(tasteFailures)} of them taste failures.
    </p>
  );
}

function NoteList<S extends Source>({ source, request, renderCard }: { source: S; request: NoteRequest; renderCard: (card: NoteCards[S]) => ReactNode }) {
  const list = useNoteList(source, request);
  const rows = list.pages?.flat();
  if (list.failed) return <LoadFailed what="These notes" onRetry={list.retry} />;
  if (!rows) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (rows.length === 0) return <p className="py-12 text-center text-sm text-fg-muted">No notes match these filters.</p>;
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.noteId}>{renderCard(row.card)}</div>
      ))}
      <PagedListEnd list={list} endText="That is every note that matches." />
    </div>
  );
}

/** One tab: the search box, the Filter button and pills, the Sort pills, the
 *  count of matching notes, and the notes, loaded page by page as the reader
 *  scrolls. The filters and sorts live in the page address, and the browser
 *  remembers each tab's last ones. Adapted from the Overview of
 *  commonnotes.net's X notewriter page. */
export function NoteTab<S extends Source>({ source, fields, renderCard }: { source: S; fields: readonly FieldDef[]; renderCard: (card: NoteCards[S]) => ReactNode }) {
  const [query, setQuery] = useFieldQuery({ storageKey: `taste:${source}:query`, fields, displayOptions: [], defaults: DEFAULT_QUERY });
  const [searchText, search, setSearchText] = useSearch();
  // Date filters count back from this moment, which is taken anew whenever
  // the filters change.
  const now = useMomentFor(JSON.stringify(query.filters));
  const request = useMemo<NoteRequest>(() => ({ ...buildRequest(fields, query, now), search }), [fields, query, now, search]);
  const facets = useNoteFacets(source, fields, request);
  useLiveAiReviews(source);
  const filterProps = { fields, filters: query.filters, facets, onChange: (filters: typeof query.filters) => setQuery({ ...query, filters }) };
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search the notes and posts"
          aria-label="Search the notes and posts"
          className="min-w-0 flex-1"
        />
        <FilterButton {...filterProps} />
      </div>
      <FilterPills {...filterProps} />
      <SortBar fields={fields} sorts={query.sorts} onChange={(sorts) => setQuery({ ...query, sorts })} />
      <Summary source={source} request={request} />
      <NoteList key={JSON.stringify(request)} source={source} request={request} renderCard={renderCard} />
    </section>
  );
}
