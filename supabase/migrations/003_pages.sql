-- What the two tabs read. Each tab has a view with one row per note, whose
-- columns are the fields the tab filters and sorts by (src/web/noteFields.ts).
-- Every list is read through three functions: a page of cards in the chosen
-- order, the count of notes that match, and the counts behind the Filter menu.
-- They check the shared login themselves and then read as their owner, so the
-- views need no rules of their own.

create view taste.x_note_fields as
select n.note_id,
       n.written,
       n.status,
       n.author_id as notewriter,
       w.name as notewriter_name,
       n.helpful_ratings + n.somewhat_helpful_ratings + n.not_helpful_ratings as ratings,
       n.helpful_ratings,
       n.not_helpful_ratings,
       case when n.helpful_ratings + n.not_helpful_ratings > 0
            then n.helpful_ratings::float8 / (n.helpful_ratings + n.not_helpful_ratings) end as helpful_share,
       (extract(epoch from n.rated_at - n.written) / 3600)::float8 as hours_to_rated,
       array(select e.key from jsonb_each_text(n.not_helpful_tags) e where e.value::int > 0 order by e.key) as rater_not_helpful_reasons,
       array(select e.key from jsonb_each_text(n.helpful_tags) e where e.value::int > 0 order by e.key) as rater_helpful_reasons,
       n.classification,
       n.writer_reasons,
       n.media_note,
       n.collaborative_note,
       case when exists (select 1 from jsonb_array_elements(n.other_notes) o where o ->> 'status' = 'helpful') then 'helpful'
            when jsonb_array_length(n.other_notes) > 0 then 'others'
            else 'none' end as other_notes,
       case when p.available then 'available' when p.available = false then 'unavailable' else 'not_fetched' end as post,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note_text, p.text, p.referenced ->> 'text', p.author_name, p.author_handle) as search_text
  from taste.x_notes n
  join taste.x_notewriters w on w.author_id = n.author_id
  left join taste.x_posts p on p.tweet_id = n.tweet_id
  left join taste.verdicts v on v.source = 'x' and v.note_id = n.note_id
  left join lateral (select array_agg(lb.name order by lb.name) as labels
                       from taste.note_labels nl join taste.labels lb on lb.id = nl.label_id
                      where nl.source = 'x' and nl.note_id = n.note_id) l on true;

create view taste.cn_note_fields as
select n.id::text as note_id,
       n.created_at as written,
       n.rating_status as status,
       n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count as votes,
       n.helpful_count as helpful_votes,
       n.somewhat_helpful_count as somewhat_votes,
       n.not_helpful_count as not_helpful_votes,
       n.p_helpful,
       n.writer,
       i.source as platform,
       i.project_id::text as creator,
       pr.name as creator_name,
       i.views,
       (select count(distinct s.url) from taste.cn_note_sources s where s.note_id = n.id) as sources,
       n.status as published,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note, c.claim, c.context_quote, i.title, pr.name) as search_text
  from taste.cn_notes n
  join taste.cn_claims c on c.id = n.claim_id
  join taste.cn_items i on i.id = c.item_id
  left join taste.cn_projects pr on pr.id = i.project_id
  left join taste.verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
  left join lateral (select array_agg(lb.name order by lb.name) as labels
                       from taste.note_labels nl join taste.labels lb on lb.id = nl.label_id
                      where nl.source = 'commonnotes' and nl.note_id = n.id::text) l on true;

-- The labels on a note, as [{ id, name }].
create function taste.note_label_list(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', lb.id, 'name', lb.name) order by lb.name), '[]')
    from note_labels nl join labels lb on lb.id = nl.label_id
   where nl.source = p_source and nl.note_id = p_note_id
$$;

-- The cards of these X notes, in no particular order.
create function taste.x_cards(p_ids text[]) returns table (note_id text, card jsonb)
language sql stable set search_path = taste as $$
  select n.note_id, jsonb_build_object(
    'noteId', n.note_id,
    'noteText', n.note_text,
    'status', n.status,
    'written', n.written,
    'notewriter', jsonb_build_object('id', w.author_id, 'name', w.name, 'isOurs', w.is_ours),
    'ratings', jsonb_build_object(
      'helpful', n.helpful_ratings, 'somewhatHelpful', n.somewhat_helpful_ratings, 'notHelpful', n.not_helpful_ratings,
      'helpfulReasons', n.helpful_tags, 'notHelpfulReasons', n.not_helpful_tags),
    'writerAnswers', jsonb_build_object(
      'classification', n.classification, 'reasons', to_jsonb(n.writer_reasons), 'trustworthySources', n.trustworthy_sources,
      'mediaNote', n.media_note, 'collaborativeNote', n.collaborative_note),
    'post', jsonb_build_object(
      'id', n.tweet_id, 'available', p.available, 'text', p.text, 'handle', p.author_handle, 'name', p.author_name,
      'postedAt', p.posted_at, 'media', coalesce(p.media, '[]'),
      'referenced', case when p.referenced is null then null
                         else p.referenced || jsonb_build_object('kind', p.referenced_kind) end),
    'otherNotes', n.other_notes,
    'verdict', v.verdict,
    'labels', note_label_list('x', n.note_id))
    from x_notes n
    join x_notewriters w on w.author_id = n.author_id
    left join x_posts p on p.tweet_id = n.tweet_id
    left join verdicts v on v.source = 'x' and v.note_id = n.note_id
   where n.note_id = any (p_ids)
$$;

-- The cards of these CommonNotes notes, in the shapes the copied website code
-- reads: `note` is a NoteRow with its claim, `post` a FeedItemRow and
-- `project` a ProjectHeader (src/core/types.ts).
create function taste.cn_cards(p_ids text[]) returns table (note_id text, card jsonb)
language sql stable set search_path = taste as $$
  select n.id::text, jsonb_build_object(
    'note', jsonb_build_object(
      'id', n.id, 'claim_id', n.claim_id, 'note', n.note,
      'sources', coalesce((select jsonb_agg(jsonb_build_object('url', s.url, 'sort_order', s.sort_order) order by s.sort_order)
                             from cn_note_sources s where s.note_id = n.id), '[]'),
      'has_source_details', exists (select 1 from cn_note_sources s where s.note_id = n.id and s.quote is not null),
      'helpful_count', n.helpful_count, 'somewhat_helpful_count', n.somewhat_helpful_count, 'not_helpful_count', n.not_helpful_count,
      'author_id', n.author_id, 'author_name', n.author_name, 'improved_from_note_id', n.improved_from_note_id,
      'status', n.status, 'created_at', n.created_at,
      'claim', jsonb_build_object(
        'id', c.id, 'item_id', c.item_id, 'claim', c.claim, 'context_quote', c.context_quote,
        'context_paragraph', c.context_paragraph, 'image_urls', c.image_urls, 'updated_quote', c.updated_quote,
        'context_url', c.context_url, 'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds)),
    'ratingStatus', n.rating_status,
    'pHelpful', n.p_helpful,
    'writer', n.writer,
    'post', jsonb_build_object('id', i.id, 'project_id', i.project_id, 'url', i.url, 'title', i.title,
                               'published_at', i.published_at, 'created_at', i.created_at),
    'platform', i.source,
    'views', i.views,
    'project', case when pr.id is null then null
                    else jsonb_build_object('id', pr.id, 'slug', pr.slug, 'name', pr.name, 'feed_url', pr.feed_url, 'avatar_url', pr.avatar_url) end,
    'verdict', v.verdict,
    'labels', note_label_list('commonnotes', n.id::text))
    from cn_notes n
    join cn_claims c on c.id = n.claim_id
    join cn_items i on i.id = c.item_id
    left join cn_projects pr on pr.id = i.project_id
    left join verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
   where n.id::text = any (p_ids)
$$;

-- The view of a tab's fields.
create function taste.fields_view(p_source text) returns regclass
language plpgsql immutable as $$
begin
  return case p_source
    when 'x' then 'taste.x_note_fields'::regclass
    when 'commonnotes' then 'taste.cn_note_fields'::regclass
    else null end;
end;
$$;

create function taste.require_labeller() returns void
language plpgsql stable set search_path = taste as $$
begin
  if not is_labeller() then raise exception 'Sign in with the shared password first' using errcode = '42501'; end if;
end;
$$;

-- One page of the notes that pass the request's filters and search, in its
-- order, starting after the note with sort key `p_after_key` and id
-- `p_after_id`. This is keyset paging: each page costs the same however deep
-- the reader scrolls.
create function taste.note_page(p_source text, p_request jsonb, p_after_key float8[] default null, p_after_id text default null, p_limit int default 10)
returns table (note_id text, sort_key float8[], card jsonb)
language plpgsql stable security definer set search_path = taste, public as $$
declare
  max_page_size constant int := 50;
  v_view regclass := fields_view(p_source);
  v_ids text[];
  v_keys jsonb;
begin
  perform require_labeller();
  if v_view is null then raise exception 'Unknown source %', p_source; end if;
  execute format($q$
      select array_agg(k.note_id order by k.sort_key, k.note_id), jsonb_agg(to_jsonb(k.sort_key) order by k.sort_key, k.note_id)
        from (select k.note_id, k.sort_key
                from (select f.note_id, %s as sort_key from %s f where %s and %s) k
               where $1 is null or (k.sort_key, k.note_id) > ($1, $2)
               order by k.sort_key, k.note_id
               limit $3) k$q$,
      field_query_sort_key(v_view, p_request -> 'sorts'), v_view,
      field_query_condition(v_view, p_request -> 'filters'), field_query_search(p_request))
    into v_ids, v_keys
    using p_after_key, p_after_id, least(greatest(p_limit, 1), max_page_size);
  if v_ids is null then return; end if;
  return query
    select c.note_id,
           array(select jsonb_array_elements_text(v_keys -> (array_position(v_ids, c.note_id) - 1)))::float8[],
           c.card
      from (select * from x_cards(v_ids) where p_source = 'x'
            union all
            select * from cn_cards(v_ids) where p_source = 'commonnotes') c
     order by array_position(v_ids, c.note_id);
end;
$$;

-- How many notes pass the request's filters and search, and how many of them
-- have a verdict.
create function taste.note_summary(p_source text, p_request jsonb)
returns table (notes bigint, judged bigint, taste_failures bigint)
language plpgsql stable security definer set search_path = taste, public as $$
declare
  v_view regclass := fields_view(p_source);
begin
  perform require_labeller();
  if v_view is null then raise exception 'Unknown source %', p_source; end if;
  return query execute format(
    $q$select count(*), count(*) filter (where f.verdict <> 'unjudged'), count(*) filter (where f.verdict = 'taste_failure')
         from %s f where %s and %s$q$,
    v_view, field_query_condition(v_view, p_request -> 'filters'), field_query_search(p_request));
end;
$$;

-- How many notes each value of the given choice fields holds:
-- [{ column, label_column? }]. Each field's count leaves out its own filter,
-- so the Filter menu shows what picking another value would give. A field
-- whose values come from the data names a column with each value's display
-- name.
create function taste.note_facets(p_source text, p_request jsonb, p_facets jsonb)
returns table (field text, value text, label text, notes bigint)
language plpgsql stable security definer set search_path = taste, public as $$
declare
  v_view regclass := fields_view(p_source);
  v_parts text[] := '{}';
  facet jsonb;
begin
  perform require_labeller();
  if v_view is null then raise exception 'Unknown source %', p_source; end if;
  for facet in select t.value from jsonb_array_elements(coalesce(p_facets, '[]'::jsonb)) t loop
    v_parts := v_parts || format(
      'select %L::text, v.value, max(%s)::text, count(*) from %s f cross join lateral unnest(%s) v(value) where %s and %s and v.value is not null group by v.value',
      facet ->> 'column',
      case when facet ? 'label_column' then taste.field_query_text(v_view, facet ->> 'label_column') else 'null' end,
      v_view,
      field_query_values(v_view, facet ->> 'column'),
      field_query_condition(v_view, p_request -> 'filters', facet ->> 'column'),
      field_query_search(p_request));
  end loop;
  if cardinality(v_parts) = 0 then return; end if;
  return query execute array_to_string(v_parts, ' union all ');
end;
$$;

-- The source quotes of a CommonNotes note, for its "Source details".
create function taste.cn_source_details(p_note_id uuid)
returns table (url text, quote text, explanation text, sort_order int)
language plpgsql stable security definer set search_path = taste as $$
begin
  perform require_labeller();
  return query select s.url, s.quote, s.explanation, s.sort_order from cn_note_sources s
                where s.note_id = p_note_id and s.quote is not null order by s.sort_order;
end;
$$;

-- Every label with how many notes carry it, most used first.
create function taste.label_list()
returns table (id bigint, name text, uses bigint)
language plpgsql stable security definer set search_path = taste as $$
begin
  perform require_labeller();
  return query select lb.id, lb.name, count(nl.label_id) from labels lb left join note_labels nl on nl.label_id = lb.id
                group by lb.id order by count(nl.label_id) desc, lb.name;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['taste.note_page(text, jsonb, float8[], text, int)', 'taste.note_summary(text, jsonb)',
                            'taste.note_facets(text, jsonb, jsonb)', 'taste.cn_source_details(uuid)', 'taste.label_list()'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
