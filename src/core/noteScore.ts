import { noteTally, probabilityHelpful, type NoteTallyFields } from "./noteBelief";

/** A note is rated once the crowd's estimate that it ends up helpful is decisive.
 *  This one predicate drives three things that used to be decided separately. It
 *  picks the badge on the card. It picks which section of the feed the note lands
 *  in. It picks which side of a frozen donation pair pays out. It replaced the
 *  old rule of at least 5 ratings plus a net-positive weighted score.
 *
 *  The two thresholds bracket the tallies Jim named on 2026-07-21, with margin on
 *  either side. The helpful threshold sits above p for 2 Helpful votes, which is
 *  0.746, and at or below p for 2 Helpful plus 1 Somewhat, which is 0.808. The
 *  unhelpful threshold sits below p for 1 Not-helpful vote, which is 0.235, and
 *  at or above p for 2 Not-helpful votes, which is 0.156. So 2 Helpful votes are
 *  not enough on their own, but 2 Helpful plus 1 Somewhat is. One Not-helpful
 *  vote is not enough, but two are. */
const RATED_HELPFUL_AT_P = 0.78;
const RATED_NOT_HELPFUL_AT_P = 0.2;
/** A note's rating state, in the style of Community Notes. It sets the badge in
 *  the note header, the feed section the note appears in, and which side of every
 *  frozen donation pair pays out. */
export type NoteStatus = "helpful" | "not_helpful" | "needs_ratings";

export function noteStatus(note: NoteTallyFields): NoteStatus {
  // There is no explicit quorum. A single vote cannot reach either threshold on
  // its own: one Helpful vote gives p = 0.577, one Somewhat gives 0.469 and one
  // Not-helpful gives 0.235. So one voter can never rate a note alone.
  const p = probabilityHelpful(noteTally(note));
  if (p >= RATED_HELPFUL_AT_P) return "helpful";
  if (p <= RATED_NOT_HELPFUL_AT_P) return "not_helpful";
  return "needs_ratings";
}
