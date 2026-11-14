import { LARGE_COUNTS, SMALL_COUNTS, type FieldDef, type FieldQuery } from "@cn/core/fieldQuery";
import { humanizeTagName } from "@cn/core/ratingReasons";
import type { Source } from "@cn/core/taste";

/* What each tab filters and sorts by. Each field's id is a column of the tab's
 * view in the database (taste.x_note_fields and taste.cn_note_fields, in
 * supabase/migrations/003_pages.sql). */

/** Thresholds for the hours until X rated a note. */
const HOUR_COUNTS = [1, 3, 6, 12, 24, 48, 96, 168, 336];
/** Thresholds for views, which run into the thousands. */
const VIEW_COUNTS = [1, 5, 10, 50, 100, 500, 1_000];

const VERDICT: FieldDef = {
  id: "verdict",
  label: "Verdict",
  kind: "choice",
  multiple: true,
  sortable: false,
  options: [
    { value: "unjudged", label: "Not judged" },
    { value: "taste_failure", label: "Taste failure" },
    { value: "fine", label: "No taste failure" },
  ],
};

const LABELS: FieldDef = { id: "labels", label: "Label", hint: "Notes with any of the picked labels. None keeps the notes without a label", kind: "choice", multiple: true, sortable: false };

const AI_RECOMMENDATION: FieldDef = {
  id: "ai_recommendation",
  label: "AI recommendation",
  kind: "choice",
  multiple: true,
  sortable: false,
  options: [
    { value: "taste_failure", label: "Taste failure" },
    { value: "fine", label: "No taste failure" },
    { value: "none", label: "No AI review yet" },
  ],
};

const RANDOM: FieldDef = { id: "shuffle", label: "Random order", hint: "The same random order for everyone", kind: "percent", sortable: true, filterable: false };

const WRITTEN: FieldDef = { id: "written", label: "Written", kind: "date", sortable: true };

export const NOTE_FIELDS: Record<Source, FieldDef[]> = {
  x: [
    VERDICT,
    LABELS,
    AI_RECOMMENDATION,
    {
      id: "status",
      label: "Status",
      kind: "choice",
      multiple: true,
      sortable: true,
      options: [
        { value: "helpful", label: "Rated helpful" },
        { value: "needs_ratings", label: "Needs more ratings", hint: "Rated when imported, and needs more ratings again since" },
        { value: "not_helpful", label: "Rated not helpful" },
      ],
    },
    { id: "notewriter", label: "Notewriter", kind: "choice", multiple: true, sortable: false, labelColumn: "notewriter_name" },
    WRITTEN,
    { id: "hours_to_rated", label: "Hours until rated", hint: "From writing the note until X first rated it helpful or not helpful", kind: "count", thresholds: HOUR_COUNTS, bound: "atMost", sortable: true },
    { id: "ratings", label: "Ratings", group: "Ratings", kind: "count", thresholds: LARGE_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "helpful_ratings", label: "Helpful ratings", group: "Ratings", kind: "count", thresholds: LARGE_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "not_helpful_ratings", label: "Not-helpful ratings", group: "Ratings", kind: "count", thresholds: LARGE_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "helpful_share", label: "Helpful share", hint: "Helpful ratings out of helpful and not-helpful ratings", group: "Ratings", kind: "percent", sortable: true },
    { id: "rater_not_helpful_reasons", label: "Raters' not-helpful reason", group: "Ratings", kind: "choice", multiple: true, sortable: false },
    { id: "rater_helpful_reasons", label: "Raters' helpful reason", group: "Ratings", kind: "choice", multiple: true, sortable: false },
    {
      id: "classification",
      label: "Writer says the post is",
      group: "Writer's answers",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "MISINFORMED_OR_POTENTIALLY_MISLEADING", label: "Misleading" },
        { value: "NOT_MISLEADING", label: "Not misleading" },
      ],
    },
    { id: "writer_reasons", label: "Writer's reasons", group: "Writer's answers", kind: "choice", multiple: true, sortable: false },
    { id: "media_note", label: "Media note", group: "Writer's answers", kind: "choice", multiple: true, sortable: false, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
    { id: "collaborative_note", label: "Collaborative note", group: "Writer's answers", kind: "choice", multiple: true, sortable: false, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
    {
      id: "other_notes",
      label: "Other notes on the post",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "none", label: "None" },
        { value: "helpful", label: "One rated helpful" },
        { value: "others", label: "Some, none rated helpful" },
      ],
    },
    {
      id: "post",
      label: "Post",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "available", label: "Available" },
        { value: "unavailable", label: "Deleted on X" },
        { value: "not_fetched", label: "Not fetched yet" },
      ],
    },
    RANDOM,
  ],
  commonnotes: [
    VERDICT,
    LABELS,
    AI_RECOMMENDATION,
    {
      id: "status",
      label: "Status",
      kind: "choice",
      multiple: true,
      sortable: true,
      options: [
        { value: "helpful", label: "Rated helpful" },
        { value: "needs_ratings", label: "Needs more ratings" },
        { value: "not_helpful", label: "Rated not helpful" },
      ],
    },
    WRITTEN,
    { id: "votes", label: "Votes", group: "Votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "helpful_votes", label: "Helpful votes", group: "Votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "somewhat_votes", label: "Somewhat helpful votes", group: "Votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "not_helpful_votes", label: "Not-helpful votes", group: "Votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "p_helpful", label: "Chance of ending helpful", hint: "The website's estimate from the votes so far", group: "Votes", kind: "percent", sortable: true },
    {
      id: "writer",
      label: "Writer",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "pipeline", label: "Pipeline" },
        { value: "claude", label: "Claude note writer" },
        { value: "reader", label: "Reader" },
      ],
    },
    {
      id: "platform",
      label: "Platform",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "youtube", label: "YouTube" },
        { value: "substack", label: "Substack" },
        { value: "lesswrong", label: "LessWrong" },
        { value: "podcast", label: "Podcast" },
        { value: "web", label: "Other web" },
      ],
    },
    { id: "creator", label: "Creator", kind: "choice", multiple: true, sortable: false, labelColumn: "creator_name" },
    { id: "views", label: "Views", hint: "Devices outside the team on which the extension showed the post's notes", kind: "count", thresholds: VIEW_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "sources", label: "Sources", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    {
      id: "published",
      label: "Published",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "published", label: "Published" },
        { value: "draft", label: "Draft" },
        { value: "hidden", label: "Hidden" },
      ],
    },
    RANDOM,
  ],
};

/** A tab opens on the newest notes first. */
export const DEFAULT_QUERY: FieldQuery = { filters: [], sorts: [{ field: "written", descending: true }], display: [] };

/** "misleadingFactualError" reads "Factual error". */
const writerReasonName = (raw: string) => {
  const words = raw.replace(/^(notMisleading|misleading)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return raw.startsWith("notMisleading") ? `Not misleading: ${words}` : words.charAt(0).toUpperCase() + words.slice(1);
};

/** How to name the values of a field whose values come from the data and have
 *  no column with their names. */
export const VALUE_NAMES: Record<string, (value: string) => string> = {
  rater_not_helpful_reasons: humanizeTagName,
  rater_helpful_reasons: humanizeTagName,
  writer_reasons: writerReasonName,
  labels: (value) => (value === "none" ? "None" : value),
};
