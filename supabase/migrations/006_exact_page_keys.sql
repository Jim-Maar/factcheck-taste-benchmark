-- A page's sort keys go to the browser and back as text. As JSON numbers
-- Postgres rounded them to 15 significant digits. A random-order value has
-- about 17 and a moment with microseconds 16, so the bookmark of the next
-- page fell just before the last card shown, and that card showed again at
-- the top of the next page. Text keeps every digit of a float8, as long as
-- extra_float_digits asks for the shortest exact form. The API's sessions set
-- it lower, so the function sets it itself.
drop function if exists taste.note_page(text, jsonb, float8[], text, int);
drop function if exists taste.note_page(text, jsonb, text[], text, int);
create function taste.note_page(p_source text, p_request jsonb, p_after_key text[] default null, p_after_id text default null, p_limit int default 10)
returns table (note_id text, sort_key text[], card jsonb)
language plpgsql stable security definer set search_path = taste, public set extra_float_digits = 1 as $$
declare
  max_page_size constant int := 50;
  v_view regclass := fields_view(p_source);
  v_ids text[];
  v_keys jsonb;
begin
  perform require_labeller();
  if v_view is null then raise exception 'Unknown source %', p_source; end if;
  execute format($q$
      select array_agg(k.note_id order by k.sort_key, k.note_id), jsonb_agg(to_jsonb(k.sort_key::text[]) order by k.sort_key, k.note_id)
        from (select k.note_id, k.sort_key
                from (select f.note_id, %s as sort_key from %s f where %s and %s) k
               where $1 is null or (k.sort_key, k.note_id) > ($1::float8[], $2)
               order by k.sort_key, k.note_id
               limit $3) k$q$,
      field_query_sort_key(v_view, p_request -> 'sorts'), v_view,
      field_query_condition(v_view, p_request -> 'filters'), field_query_search(p_request))
    into v_ids, v_keys
    using p_after_key, p_after_id, least(greatest(p_limit, 1), max_page_size);
  if v_ids is null then return; end if;
  return query
    select c.note_id,
           array(select jsonb_array_elements_text(v_keys -> (array_position(v_ids, c.note_id) - 1))),
           c.card
      from (select * from x_cards(v_ids) where p_source = 'x'
            union all
            select * from cn_cards(v_ids) where p_source = 'commonnotes') c
     order by array_position(v_ids, c.note_id);
end;
$$;
revoke execute on function taste.note_page(text, jsonb, text[], text, int) from public, anon;
grant execute on function taste.note_page(text, jsonb, text[], text, int) to authenticated;
