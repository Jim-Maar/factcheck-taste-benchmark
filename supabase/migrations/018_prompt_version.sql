-- Which prompt a review was made with: the commit that last changed the
-- reviewer's instructions and tools (PROMPT_FILES in scripts/ai/run.ts), so
-- the models can be compared only on reviews made with the same prompt.
-- scripts/ai/run.ts sets it; it is null for reviews made before this.
alter table taste.ai_reviews add column prompt_version text;
