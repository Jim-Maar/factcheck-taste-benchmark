import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { addNoteLabel, createLabel, fetchLabels, removeNoteLabel, saveVerdict, type Label, type PagedCard, type Source, type Verdict } from "@cn/core/taste";
import { queryKeys } from "../query/queryKeys";

/** Every label, most used first. */
export const useLabels = () => useQuery({ queryKey: queryKeys.labels, queryFn: fetchLabels });

type CardPatch = { verdict?: Verdict | null; labels?: Label[] };

/** Changes one note's card in every loaded page of its tab, so the card shows
 *  a write at once. The lists themselves are not reloaded. A reload would move
 *  or drop the card under the reader, for example from a list of notes
 *  without a verdict. */
function patchCard(client: QueryClient, source: Source, noteId: string, patch: (card: CardPatch & { labels: Label[] }) => CardPatch) {
  client.setQueriesData<InfiniteData<PagedCard<Source>[]>>({ queryKey: queryKeys.notes(source) }, (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => page.map((row) => (row.noteId === noteId ? { ...row, card: { ...row.card, ...patch(row.card) } } : row))),
    },
  );
}

/** Reloads what counts notes: the count line, the Filter menu and the labels'
 *  use counts. */
function refreshCounts(client: QueryClient, source: Source) {
  void client.invalidateQueries({ queryKey: queryKeys.summary(source) });
  void client.invalidateQueries({ queryKey: queryKeys.facets(source) });
  void client.invalidateQueries({ queryKey: queryKeys.labels });
}

/** The writes of the labelling bar for one tab. Each one saves first and then
 *  updates the card, so a card never shows something the database refused. */
export function useLabelling(source: Source) {
  const client = useQueryClient();
  const setVerdict = async (noteId: string, verdict: Verdict | null) => {
    await saveVerdict(source, noteId, verdict);
    patchCard(client, source, noteId, () => ({ verdict }));
    refreshCounts(client, source);
  };
  const addLabel = async (noteId: string, label: Label) => {
    await addNoteLabel(source, noteId, label.id);
    patchCard(client, source, noteId, (card) => ({ labels: [...card.labels.filter((l) => l.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name)) }));
    refreshCounts(client, source);
  };
  const removeLabel = async (noteId: string, label: Label) => {
    await removeNoteLabel(source, noteId, label.id);
    patchCard(client, source, noteId, (card) => ({ labels: card.labels.filter((l) => l.id !== label.id) }));
    refreshCounts(client, source);
  };
  const createAndAddLabel = async (noteId: string, name: string) => addLabel(noteId, await createLabel(name));
  return { setVerdict, addLabel, removeLabel, createAndAddLabel };
}
