-- Filter and sort helpers for any row type, copied from cn-return-bot's
-- migration 159 (migrations/159_notewriter_dashboards.sql, part 3).
--
-- A page lists its fields once (src/core/fieldQuery.ts) and sends its filters
-- and sorts as JSON. These helpers turn that JSON into SQL against one row
-- type, and refuse any column the row type does not have. Every row type has a
-- "written" column, which settles ties, newest first.
--
-- One addition to the original: a choice field may be a text[] column, such
-- as a note's labels. A filter on it keeps the rows that hold any of the
-- picked values. The value "none" keeps the rows whose list is empty.

-- The SQL type of a column of a row type, or null when it has none.
create function taste.field_query_type(p_row regclass, p_column text) returns text
language sql stable set search_path = taste, public as $$
  select format_type(a.atttypid, a.atttypmod)
    from pg_attribute a
   where a.attrelid = p_row and a.attname = p_column and a.attnum > 0 and not a.attisdropped
$$;

-- A column as a number, for comparing and sorting: a moment as seconds since
-- 1970, true and false as 1 and 0. Null for a text column.
create function taste.field_query_number(p_row regclass, p_column text) returns text
language plpgsql stable set search_path = taste, public as $$
declare
  v_type text := taste.field_query_type(p_row, p_column);
begin
  if v_type is null then raise exception 'Unknown field %', p_column; end if;
  return case
    when v_type = 'timestamp with time zone' then format('extract(epoch from f.%I)::float8', p_column)
    when v_type = 'boolean' then format('f.%I::int::float8', p_column)
    when v_type in ('integer', 'bigint', 'double precision', 'numeric') then format('f.%I::float8', p_column)
    else null
  end;
end;
$$;

-- A column as text, for choices. A text[] column is handled by the callers.
create function taste.field_query_text(p_row regclass, p_column text) returns text
language plpgsql stable set search_path = taste, public as $$
declare
  v_base text := split_part(p_column, '.', 1);
  v_key text := nullif(substr(p_column, length(v_base) + 2), '');
  v_type text := taste.field_query_type(p_row, v_base);
begin
  if v_type is null then raise exception 'Unknown field %', p_column; end if;
  if v_key is null then return format('f.%I::text', v_base); end if;
  if v_type <> 'jsonb' then raise exception 'Field % has no keys', v_base; end if;
  return format('(f.%I ->> %L)', v_base, v_key);
end;
$$;

-- The values of a choice column as a list: the list itself for a text[]
-- column, with "none" standing for an empty list, and a one-value list for
-- any other column.
create function taste.field_query_values(p_row regclass, p_column text) returns text
language plpgsql stable set search_path = taste, public as $$
begin
  if taste.field_query_type(p_row, p_column) = 'text[]' then
    return format('(case when cardinality(f.%1$I) = 0 then array[''none''] else f.%1$I end)', p_column);
  end if;
  return format('array[%s]', taste.field_query_text(p_row, p_column));
end;
$$;

-- The condition of a request's filters, leaving out those on `p_skip_column`:
-- [{ column, min?, max? } | { column, in: [...] }], all of which must hold.
create function taste.field_query_condition(p_row regclass, p_filters jsonb, p_skip_column text default null) returns text
language plpgsql stable set search_path = taste, public as $$
declare
  f jsonb;
  v_number text;
  v_parts text[] := array['true'];
begin
  for f in select t.value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) t loop
    continue when f ->> 'column' = p_skip_column;
    if f ? 'in' then
      v_parts := v_parts || format('%s && %L::text[]', taste.field_query_values(p_row, f ->> 'column'), array(select jsonb_array_elements_text(f -> 'in')));
    else
      v_number := taste.field_query_number(p_row, f ->> 'column');
      if v_number is null then raise exception 'Field % is not a number', f ->> 'column'; end if;
      if f ? 'min' then v_parts := v_parts || format('%s >= %s', v_number, (f ->> 'min')::float8); end if;
      if f ? 'max' then v_parts := v_parts || format('%s <= %s', v_number, (f ->> 'max')::float8); end if;
    end if;
  end loop;
  return array_to_string(v_parts, ' and ');
end;
$$;

-- One element of a sort key: the value, negated for a descending sort, and
-- infinity when it is missing, so missing values sort last.
create function taste.field_query_signed(p_value text, p_sort jsonb) returns text
language sql immutable as $$
  select format('coalesce(%s, ''infinity''::float8)', case when coalesce((p_sort ->> 'descending')::boolean, false) then format('-(%s)', p_value) else p_value end)
$$;

-- The sort key of a request's sorts, as an expression for an array of
-- numbers: [{ column, descending, buckets?, order? }]. It sorts in two passes.
-- The first pass takes every level in turn: a choice by its value's position
-- in `order`, worst first, a number with `buckets` by how many of those
-- ascending boundaries it reaches, and any other number by itself. Rows that
-- tie on all of that form a group, and the second pass orders each group by
-- the exact values of the bucketed levels, again in turn. The row's `written`
-- time, newest first, settles the rest. A descending level is negated in both
-- passes, and a missing value sorts last.
create function taste.field_query_sort_key(p_row regclass, p_sorts jsonb) returns text
language plpgsql stable set search_path = taste, public as $$
declare
  s jsonb;
  v_exact text;
  v_first text[] := '{}';
  v_second text[] := '{}';
begin
  for s in select t.value from jsonb_array_elements(coalesce(p_sorts, '[]'::jsonb)) t loop
    if s ? 'order' then
      v_first := v_first || taste.field_query_signed(format('array_position(%L::text[], %s)::float8', array(select jsonb_array_elements_text(s -> 'order')), taste.field_query_text(p_row, s ->> 'column')), s);
      continue;
    end if;
    v_exact := taste.field_query_number(p_row, s ->> 'column');
    if v_exact is null then raise exception 'Field % cannot be sorted', s ->> 'column'; end if;
    if s ? 'buckets' then
      v_first := v_first || taste.field_query_signed(format('case when %1$s is null then null else (select count(*) from unnest(%2$L::float8[]) b where b <= %1$s)::float8 end',
                                                            v_exact, array(select jsonb_array_elements_text(s -> 'buckets'))::float8[]), s);
      v_second := v_second || taste.field_query_signed(v_exact, s);
    else
      v_first := v_first || taste.field_query_signed(v_exact, s);
    end if;
  end loop;
  return format('array[%s]::float8[]', array_to_string(v_first || v_second || 'coalesce(-extract(epoch from f.written)::float8, 0)'::text, ', '));
end;
$$;

-- The condition of the request's search text: every word must appear in the
-- row's search_text, in any order and any case. An empty search keeps all.
create function taste.field_query_search(p_request jsonb) returns text
language sql immutable as $$
  select coalesce(
    (select string_agg(format('f.search_text ilike %L', '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'), ' and ')
       from regexp_split_to_table(trim(coalesce(p_request ->> 'search', '')), '\s+') w
      where w <> ''),
    'true')
$$;
