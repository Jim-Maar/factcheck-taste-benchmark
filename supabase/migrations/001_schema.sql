-- The taste schema lives in the Supabase project epistemics-playground, next
-- to that project's own tables in public. Everything of this repository is in
-- this one schema, so the two never touch.
create schema if not exists taste;
grant usage on schema taste to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- X: Community Notes by AI notewriters, from X's public data.

-- One AI notewriter, by the anonymous author id X's public data gives it.
create table taste.x_notewriters (
  author_id text primary key,
  name text not null,
  is_ours boolean not null default false
);

-- A post that a copied note is on. X's public data has no post text, so the
-- import takes it from cn-return-bot's tweets table or from X's embed
-- endpoint. `available` is null until the import has tried to fetch the post,
-- and false when X no longer has it.
create table taste.x_posts (
  tweet_id text primary key,
  available boolean,
  author_name text,
  author_handle text,
  text text,
  posted_at timestamptz,
  -- Photos and videos, in the X API's shape: [{ type, url, preview_image_url, variants }].
  media jsonb not null default '[]',
  -- The quoted or replied-to post: { text, media }.
  referenced jsonb,
  -- quoted, replied_to or retweeted.
  referenced_kind text,
  fetched_at timestamptz
);

-- One note by an AI notewriter that X's public data rated helpful or not
-- helpful when it was imported. A later import may find it back at
-- needs_ratings. The row then stays, so its verdict and labels stay too.
create table taste.x_notes (
  note_id text primary key,
  tweet_id text not null,
  author_id text not null references taste.x_notewriters,
  note_text text not null,
  written timestamptz not null,
  status text not null check (status in ('helpful', 'not_helpful', 'needs_ratings')),
  -- When the note first got a status other than needs more ratings.
  rated_at timestamptz,
  -- The writer's own answers when writing the note.
  classification text,
  writer_reasons text[] not null default '{}',
  trustworthy_sources boolean,
  media_note boolean,
  collaborative_note boolean,
  helpful_ratings int not null default 0,
  somewhat_helpful_ratings int not null default 0,
  not_helpful_ratings int not null default 0,
  -- { reason: count } for the reasons raters ticked, by side.
  helpful_tags jsonb not null default '{}',
  not_helpful_tags jsonb not null default '{}',
  -- The other notes on the same post, by anyone: [{ noteId, text, status, isAi }].
  other_notes jsonb not null default '[]',
  -- A random number fixed at import, for a random order that survives paging.
  shuffle float8 not null default random(),
  -- The date of the public data the row was last read from.
  dump_date date not null
);
create index on taste.x_notes (tweet_id);

-- ---------------------------------------------------------------------------
-- CommonNotes: every note on commonnotes.net, with the columns of the original
-- everything_* tables that the copied website code reads.

create table taste.cn_projects (
  id uuid primary key,
  slug text not null,
  name text not null,
  feed_url text,
  avatar_url text
);

create table taste.cn_items (
  id uuid primary key,
  project_id uuid references taste.cn_projects,
  source text not null,
  url text not null,
  title text,
  published_at date,
  created_at timestamptz not null,
  -- The devices outside the team on which the extension showed the item's notes.
  views int not null default 0
);

create table taste.cn_claims (
  id uuid primary key,
  item_id uuid not null references taste.cn_items,
  claim text not null,
  context_quote text,
  context_paragraph text,
  context_url text,
  image_urls jsonb not null default '[]',
  updated_quote text,
  start_seconds float8,
  end_seconds float8
);

create table taste.cn_notes (
  id uuid primary key,
  claim_id uuid not null references taste.cn_claims,
  note text not null,
  author_id uuid,
  author_name text,
  improved_from_note_id uuid,
  -- published, draft or hidden, as on commonnotes.net.
  status text not null,
  created_at timestamptz not null,
  helpful_count int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  p_helpful float8,
  -- helpful, not_helpful or needs_ratings, by the website's own rule
  -- (noteStatus in src/core/noteScore.ts), worked out by the import.
  rating_status text not null check (rating_status in ('helpful', 'not_helpful', 'needs_ratings')),
  -- pipeline, claude or reader.
  writer text not null,
  shuffle float8 not null default random()
);
create index on taste.cn_notes (claim_id);

create table taste.cn_note_sources (
  id uuid primary key,
  note_id uuid not null references taste.cn_notes on delete cascade,
  url text not null,
  quote text,
  explanation text,
  sort_order int not null default 0
);
create index on taste.cn_note_sources (note_id);

-- ---------------------------------------------------------------------------
-- Labelling. Everyone signs in with one shared password, so a verdict and a
-- label belong to the note, not to a person.

-- The Supabase users who may read and label. There is one: the shared login.
create table taste.labellers (user_id uuid primary key references auth.users on delete cascade);

create table taste.verdicts (
  source text not null check (source in ('x', 'commonnotes')),
  note_id text not null,
  verdict text not null check (verdict in ('taste_failure', 'fine')),
  updated_at timestamptz not null default now(),
  primary key (source, note_id)
);

create table taste.labels (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index labels_name_key on taste.labels (lower(name));

create table taste.note_labels (
  source text not null check (source in ('x', 'commonnotes')),
  note_id text not null,
  label_id bigint not null references taste.labels on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source, note_id, label_id)
);
create index on taste.note_labels (label_id);

-- Every change to a verdict or a label on a note. Everyone shares one login,
-- so this is how a mistaken click is found and undone.
create table taste.label_history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  note_id text not null,
  kind text not null check (kind in ('verdict', 'label')),
  old_value text,
  new_value text
);

create function taste.log_verdict() returns trigger
language plpgsql security definer set search_path = taste as $$
begin
  if tg_op = 'DELETE' then
    insert into label_history (source, note_id, kind, old_value) values (old.source, old.note_id, 'verdict', old.verdict);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.verdict = new.verdict then return new; end if;
  insert into label_history (source, note_id, kind, old_value, new_value)
  values (new.source, new.note_id, 'verdict', case when tg_op = 'UPDATE' then old.verdict end, new.verdict);
  return new;
end;
$$;
create trigger log_verdict after insert or update or delete on taste.verdicts for each row execute function taste.log_verdict();

create function taste.log_note_label() returns trigger
language plpgsql security definer set search_path = taste as $$
begin
  if tg_op = 'DELETE' then
    insert into label_history (source, note_id, kind, old_value)
    select old.source, old.note_id, 'label', l.name from labels l where l.id = old.label_id;
    return old;
  end if;
  insert into label_history (source, note_id, kind, new_value)
  select new.source, new.note_id, 'label', l.name from labels l where l.id = new.label_id;
  return new;
end;
$$;
create trigger log_note_label after insert or delete on taste.note_labels for each row execute function taste.log_note_label();

-- ---------------------------------------------------------------------------
-- Access. The page carries only the public key. Without the shared login it
-- can read nothing, because no rule grants the anon role anything. The note
-- tables have no write rule: only the import writes them, with the service key.

create function taste.is_labeller() returns boolean
language sql stable security definer set search_path = taste as $$
  select exists (select 1 from labellers where user_id = auth.uid())
$$;
revoke execute on function taste.is_labeller() from public, anon;
grant execute on function taste.is_labeller() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['x_notewriters', 'x_posts', 'x_notes', 'cn_projects', 'cn_items', 'cn_claims', 'cn_notes', 'cn_note_sources',
                           'labellers', 'verdicts', 'labels', 'note_labels', 'label_history'] loop
    execute format('alter table taste.%I enable row level security', t);
    execute format('grant select on taste.%I to authenticated', t);
    execute format('create policy labellers_read on taste.%I for select to authenticated using ((select taste.is_labeller()))', t);
  end loop;
  foreach t in array array['verdicts', 'labels', 'note_labels'] loop
    execute format('grant insert, update, delete on taste.%I to authenticated', t);
    execute format('create policy labellers_insert on taste.%I for insert to authenticated with check ((select taste.is_labeller()))', t);
    execute format('create policy labellers_update on taste.%I for update to authenticated using ((select taste.is_labeller())) with check ((select taste.is_labeller()))', t);
    execute format('create policy labellers_delete on taste.%I for delete to authenticated using ((select taste.is_labeller()))', t);
  end loop;
end;
$$;
grant all on all tables in schema taste to service_role;
grant usage, select on all sequences in schema taste to service_role;
