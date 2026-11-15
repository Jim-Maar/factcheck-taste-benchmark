import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@cn/features/query/queryClient";
import { XNoteCard } from "../src/web/pages/x/XNoteCard";
import "../src/web/index.css";
import posts from "./posts.json";

if (location.hash === "#dark") document.documentElement.classList.add("dark");
const note = (post: any, i: number) => ({
  noteId: String(i), noteText: "This claim is missing context. The bill was introduced but has not passed either chamber, and federal holidays require an act of Congress signed by the President. https://www.congress.gov/bill/119th-congress",
  status: (["helpful", "not_helpful", "needs_ratings"] as const)[i % 3], written: "2026-11-10T12:00:00Z",
  notewriter: { id: "abc", name: "Grok notewriter", isOurs: false },
  ratings: { helpful: 12, somewhatHelpful: 3, notHelpful: 4, helpfulReasons: { helpfulClear: 5 }, notHelpfulReasons: {} },
  writerAnswers: { classification: "MISINFORMED_OR_POTENTIALLY_MISLEADING", reasons: [], trustworthySources: true, mediaNote: i === 2, collaborativeNote: false },
  post, otherNotes: i === 0 ? [{ noteId: "x", text: "Other note", status: "needs_ratings", isAi: false }] : [],
  verdict: i === 1 ? "fine" : null, accuracy: i === 1 ? "correct" : null, labels: i === 1 ? [{ id: 1, name: "Too long" }] : [], ai: null, comment: null,
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      {(posts as any[]).map((p, i) => <XNoteCard key={i} note={note(p, i) as any} />)}
    </div>
  </QueryClientProvider>,
);
