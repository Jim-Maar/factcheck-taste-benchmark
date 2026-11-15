/* What each taste-failure label means, in one line. The labelling site shows
 * these beside the labels, and scripts/ai/run.ts gives the same text to the
 * AI reviewer, so humans and models label against one definition. Keys are
 * the label names in taste.labels, compared ignoring case. A label added on
 * the site without an entry here has no definition until one is added.
 *
 * DRAFT (2026-11-15): to be reviewed by the team. */

export const LABEL_DEFINITIONS: Record<string, string> = {
  pedantic: "Corrects a detail that is true but doesn't change the post's main point.",
  "missed-joke": "Fact-checks a joke, satire, opinion or obvious exaggeration as if it were a literal claim.",
  "misunderstands author": "Gets wrong what the author meant: their stance, their target, or who they are.",
  "critiques an unnatural reading": "Refutes a reading of the post that few readers would take, instead of its plain meaning.",
  unrelated: "Addresses a claim the post doesn't make, or adds context that has nothing to do with it.",
  "bad model of reader": "Tells readers something they already know, or that the post itself already makes clear.",
  "authority-bias": "Treats an official or institutional source as settling a question that is genuinely disputed.",
  unclear: "Is hard to follow: vague, confusing, or never says what is wrong with the post.",
};

/** The definition of a label, or null when it has none yet. */
export const labelDefinition = (name: string): string | null => LABEL_DEFINITIONS[name.toLowerCase()] ?? null;
