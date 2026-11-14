-- Some filter columns were worked out from JSON on every request: the reasons
-- raters ticked and whether another note on the post is rated helpful. Over
-- 41,000 X notes that took more than a second per scan, and the Filter menu
-- scans once per request. They are now real columns, which a trigger fills
-- whenever the import writes a note. The labels and the number of sources are
-- now read with one grouped lookup instead of one lookup per note.

alter table taste.x_notes
  add column rater_not_helpful_reasons text[] not null default '{}',
  add column rater_helpful_reasons text[] not null default '{}',
  add column other_notes_state text not null default 'none';

create function taste.ticked_reasons(p_tags jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(e.key order by e.key), '{}') from jsonb_each_text(p_tags) e where e.value::int > 0
$$;

-- none, helpful (another note on the post is rated helpful) or others.
create function taste.other_notes_state(p_other_notes jsonb) returns text
language sql immutable as $$
  select case when exists (select 1 from jsonb_array_elements(p_other_notes) o where o ->> 'status' = 'helpful') then 'helpful'
              when jsonb_array_length(p_other_notes) > 0 then 'others'
              else 'none' end
$$;

create function taste.fill_x_note_columns() returns trigger
language plpgsql set search_path = taste as $$
begin
  new.rater_not_helpful_reasons := ticked_reasons(new.not_helpful_tags);
  new.rater_helpful_reasons := ticked_reasons(new.helpful_tags);
  new.other_notes_state := other_notes_state(new.other_notes);
  return new;
end;
$$;
create trigger fill_x_note_columns before insert or update of helpful_tags, not_helpful_tags, other_notes on taste.x_notes
  for each row execute function taste.fill_x_note_columns();

update taste.x_notes set helpful_tags = helpful_tags;

-- The labels of every note of a source, as one grouped lookup.
create view taste.note_label_names as
select nl.source, nl.note_id, array_agg(lb.name order by lb.name) as labels
  from taste.note_labels nl join taste.labels lb on lb.id = nl.label_id
 group by nl.source, nl.note_id;

drop view taste.x_note_fields;
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
       n.rater_not_helpful_reasons,
       n.rater_helpful_reasons,
       n.classification,
       n.writer_reasons,
       n.media_note,
       n.collaborative_note,
       n.other_notes_state as other_notes,
       case when p.available then 'available' when p.available = false then 'unavailable' else 'not_fetched' end as post,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note_text, p.text, p.referenced ->> 'text', p.author_name, p.author_handle) as search_text
  from taste.x_notes n
  join taste.x_notewriters w on w.author_id = n.author_id
  left join taste.x_posts p on p.tweet_id = n.tweet_id
  left join taste.verdicts v on v.source = 'x' and v.note_id = n.note_id
  left join taste.note_label_names l on l.source = 'x' and l.note_id = n.note_id;

drop view taste.cn_note_fields;
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
       coalesce(s.sources, 0) as sources,
       n.status as published,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note, c.claim, c.context_quote, i.title, pr.name) as search_text
  from taste.cn_notes n
  join taste.cn_claims c on c.id = n.claim_id
  join taste.cn_items i on i.id = c.item_id
  left join taste.cn_projects pr on pr.id = i.project_id
  left join (select note_id, count(distinct url) as sources from taste.cn_note_sources group by note_id) s on s.note_id = n.id
  left join taste.verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
  left join taste.note_label_names l on l.source = 'commonnotes' and l.note_id = n.id::text;
