-- The Filter menu's counts in one pass over the tab's view instead of one
-- scan per field. Each row lists, for every field, its values and whether it
-- passes the request's other filters, and one grouping counts them all. Each
-- field's count still leaves out its own filter, so the menu shows what
-- picking another value would give. With twelve fields on the X tab this cut
-- the call from about 4 seconds to well under one.
create or replace function taste.note_facets(p_source text, p_request jsonb, p_facets jsonb)
returns table (field text, value text, label text, notes bigint)
language plpgsql stable security definer set search_path = taste, public as $$
declare
  v_view regclass := fields_view(p_source);
  v_rows text[] := '{}';
  facet jsonb;
begin
  perform require_labeller();
  if v_view is null then raise exception 'Unknown source %', p_source; end if;
  for facet in select t.value from jsonb_array_elements(coalesce(p_facets, '[]'::jsonb)) t loop
    v_rows := v_rows || format('(%L::text, %s, %s::text, %s)',
      facet ->> 'column',
      field_query_values(v_view, facet ->> 'column'),
      case when facet ? 'label_column' then taste.field_query_text(v_view, facet ->> 'label_column') else 'null' end,
      field_query_condition(v_view, p_request -> 'filters', facet ->> 'column'));
  end loop;
  if cardinality(v_rows) = 0 then return; end if;
  return query execute format($q$
    select d.field, v.value, max(d.label), count(*)
      from %s f
     cross join lateral (values %s) d(field, vals, label, passes)
     cross join lateral unnest(d.vals) v(value)
     where %s and d.passes and v.value is not null
     group by d.field, v.value$q$,
    v_view, array_to_string(v_rows, ', '), field_query_search(p_request));
end;
$$;
