-- The judge may now answer Unsure, to "Taste failure?" and to "Needs a
-- community note?", as the labellers can.
alter table taste.ai_reviews drop constraint ai_reviews_recommendation_check;
alter table taste.ai_reviews add constraint ai_reviews_recommendation_check check (recommendation in ('taste_failure', 'fine', 'unsure'));
alter table taste.ai_reviews drop constraint ai_reviews_needs_note_check;
alter table taste.ai_reviews add constraint ai_reviews_needs_note_check check (needs_note in ('yes', 'no', 'unsure'));

-- The AI recommendation filter gains 'unsure', for notes where every model
-- that reviewed it is unsure.
create or replace view taste.ai_recommendations as
select source, note_id,
       case when bool_and(recommendation = 'taste_failure') then 'taste_failure'
            when bool_and(recommendation = 'fine') then 'fine'
            when bool_and(recommendation = 'unsure') then 'unsure'
            else 'split' end as recommendation
  from taste.ai_reviews
 group by source, note_id;
