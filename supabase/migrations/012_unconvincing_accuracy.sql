-- A note can be correct but unconvincing: its facts hold, but it does not
-- show them well enough to persuade a reader.
alter table taste.accuracy drop constraint accuracy_accuracy_check;
alter table taste.accuracy add constraint accuracy_accuracy_check check (accuracy in ('correct', 'unconvincing', 'partly', 'wrong', 'unsure'));
