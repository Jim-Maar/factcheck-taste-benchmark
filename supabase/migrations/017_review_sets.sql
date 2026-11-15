-- Review sets: named lists of notes that every model reviews, so the models
-- can be compared on the same notes and the labellers can work through them.
-- The X tab gets a Review set filter. The first set, shared-100, is the 100
-- notes in scripts/ai/sets/shared-100.txt: every note a labeller had judged by
-- 2026-11-15, then notes Fable or Luna had reviewed, all on posts still on X.

create table taste.review_sets (
  name text not null,
  source text not null check (source in ('x', 'commonnotes')),
  note_id text not null,
  primary key (name, source, note_id)
);

alter table taste.review_sets enable row level security;
grant select on taste.review_sets to authenticated;
create policy labellers_read on taste.review_sets for select to authenticated using ((select taste.is_labeller()));
grant all on taste.review_sets to service_role;

insert into taste.review_sets (name, source, note_id) values
  ('shared-100', 'x', '2120330982687391986'),
  ('shared-100', 'x', '2120298739084513314'),
  ('shared-100', 'x', '2120246263979417647'),
  ('shared-100', 'x', '2120240035148558473'),
  ('shared-100', 'x', '2120240032283787481'),
  ('shared-100', 'x', '2119983121282044192'),
  ('shared-100', 'x', '2119692309256102151'),
  ('shared-100', 'x', '2119118879293079881'),
  ('shared-100', 'x', '2118567332264259846'),
  ('shared-100', 'x', '2118546328561016991'),
  ('shared-100', 'x', '2118295515221639328'),
  ('shared-100', 'x', '2117918329524388177'),
  ('shared-100', 'x', '2117738121949553138'),
  ('shared-100', 'x', '2117338677483565455'),
  ('shared-100', 'x', '2117282469028172035'),
  ('shared-100', 'x', '2117030872134324461'),
  ('shared-100', 'x', '2116716553387262340'),
  ('shared-100', 'x', '2107803627809038382'),
  ('shared-100', 'x', '2106401654799032568'),
  ('shared-100', 'x', '2097349696402428402'),
  ('shared-100', 'x', '2030442062517084167'),
  ('shared-100', 'x', '2120298994303713314'),
  ('shared-100', 'x', '2120288371268288661'),
  ('shared-100', 'x', '2120270916026355752'),
  ('shared-100', 'x', '2120267797687046461'),
  ('shared-100', 'x', '2120254182875639906'),
  ('shared-100', 'x', '2120213039748206684'),
  ('shared-100', 'x', '2120122619269718177'),
  ('shared-100', 'x', '2119873193280155753'),
  ('shared-100', 'x', '2119654450847424718'),
  ('shared-100', 'x', '2119282449049882912'),
  ('shared-100', 'x', '2119276819526406221'),
  ('shared-100', 'x', '2119201553336680814'),
  ('shared-100', 'x', '2118907103679037834'),
  ('shared-100', 'x', '2118832498809720890'),
  ('shared-100', 'x', '2118831403928273372'),
  ('shared-100', 'x', '2118779475387134179'),
  ('shared-100', 'x', '2117556359054975119'),
  ('shared-100', 'x', '2117397037066924382'),
  ('shared-100', 'x', '2117346378611572760'),
  ('shared-100', 'x', '2116905192952119663'),
  ('shared-100', 'x', '2116808232161128698'),
  ('shared-100', 'x', '2116786291249647629'),
  ('shared-100', 'x', '2036553094834573499'),
  ('shared-100', 'x', '2018621720706560467'),
  ('shared-100', 'x', '2120215331666907456'),
  ('shared-100', 'x', '2120213003740029113'),
  ('shared-100', 'x', '2120204520068157516'),
  ('shared-100', 'x', '2120195481020084606'),
  ('shared-100', 'x', '2120188798692741296'),
  ('shared-100', 'x', '2120186932361629813'),
  ('shared-100', 'x', '2120168078830891183'),
  ('shared-100', 'x', '2119851569680146554'),
  ('shared-100', 'x', '2120280341306900814'),
  ('shared-100', 'x', '2120274969909141598'),
  ('shared-100', 'x', '2120252861787382022'),
  ('shared-100', 'x', '2120251564866638147'),
  ('shared-100', 'x', '2120240196306313650'),
  ('shared-100', 'x', '2120224349265215634'),
  ('shared-100', 'x', '2120220461321642199'),
  ('shared-100', 'x', '2120220398625136941'),
  ('shared-100', 'x', '2120220151052140658'),
  ('shared-100', 'x', '2116666163740782917'),
  ('shared-100', 'x', '2116593084859293716'),
  ('shared-100', 'x', '2116348994456822052'),
  ('shared-100', 'x', '2116219729530749234'),
  ('shared-100', 'x', '2116002658050101452'),
  ('shared-100', 'x', '2115745127977328719'),
  ('shared-100', 'x', '2115443166761611702'),
  ('shared-100', 'x', '2115439524553670950'),
  ('shared-100', 'x', '2115340602711691698'),
  ('shared-100', 'x', '2114764035321438503'),
  ('shared-100', 'x', '2114749418549252543'),
  ('shared-100', 'x', '2114710668633113059'),
  ('shared-100', 'x', '2114551180126744635'),
  ('shared-100', 'x', '2113661320604336618'),
  ('shared-100', 'x', '2113271917801074948'),
  ('shared-100', 'x', '2112995902529110099'),
  ('shared-100', 'x', '2112860290249380299'),
  ('shared-100', 'x', '2112136557360718085'),
  ('shared-100', 'x', '2110296357391028351'),
  ('shared-100', 'x', '2110203068356985007'),
  ('shared-100', 'x', '2110128072280142289'),
  ('shared-100', 'x', '2110128043184591149'),
  ('shared-100', 'x', '2110121083949166653'),
  ('shared-100', 'x', '2110112794574303677'),
  ('shared-100', 'x', '2109682556807340511'),
  ('shared-100', 'x', '2109678779475861930'),
  ('shared-100', 'x', '2109642858135273723'),
  ('shared-100', 'x', '2109440683392037360'),
  ('shared-100', 'x', '2109101058765242605'),
  ('shared-100', 'x', '2108889442396377532'),
  ('shared-100', 'x', '2108827865135325341'),
  ('shared-100', 'x', '2108444484283371549'),
  ('shared-100', 'x', '2108174425010909570'),
  ('shared-100', 'x', '2108141332124340410'),
  ('shared-100', 'x', '2107756443357049114'),
  ('shared-100', 'x', '2107553468965609834'),
  ('shared-100', 'x', '2107545881104855346'),
  ('shared-100', 'x', '2107515034914234528');

-- The sets of every note, as one grouped lookup, like taste.note_label_names.
create view taste.review_set_names as
select source, note_id, array_agg(name order by name) as sets
  from taste.review_sets
 group by source, note_id;

-- The X filter view as in 014, with the note's review sets last.
create or replace view taste.x_note_fields as
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
       concat_ws(' ', n.note_text, p.text, p.referenced ->> 'text', p.author_name, p.author_handle) as search_text,
       coalesce(a.recommendation, 'none') as ai_recommendation,
       coalesce(s.sets, '{}') as review_sets
  from taste.x_notes n
  join taste.x_notewriters w on w.author_id = n.author_id
  left join taste.x_posts p on p.tweet_id = n.tweet_id
  left join taste.verdicts v on v.source = 'x' and v.note_id = n.note_id
  left join taste.note_label_names l on l.source = 'x' and l.note_id = n.note_id
  left join taste.ai_recommendations a on a.source = 'x' and a.note_id = n.note_id
  left join taste.review_set_names s on s.source = 'x' and s.note_id = n.note_id;
