import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { watchAiReviews, type Source } from "@cn/core/taste";
import { queryKeys } from "../query/queryKeys";
import { patchCard } from "./useLabelling";

/** Puts each AI review into its card the moment the reviewer saves it, while
 *  the tab is open, in place of that model's earlier review. The Filter menu's counts reload, because they count the
 *  AI recommendations. */
export function useLiveAiReviews(source: Source) {
  const client = useQueryClient();
  useEffect(
    () =>
      watchAiReviews(source, (noteId, review) => {
        patchCard(client, source, noteId, (card) => ({ ai: [...card.ai.filter((other) => other.model !== review.model), review].sort((a, b) => a.model.localeCompare(b.model)) }));
        void client.invalidateQueries({ queryKey: queryKeys.facets(source) });
      }),
    [client, source],
  );
}
