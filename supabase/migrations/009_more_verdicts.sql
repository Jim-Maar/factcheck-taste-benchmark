-- A verdict can also be "somewhat" a taste failure, or "unsure".
alter table taste.verdicts drop constraint verdicts_verdict_check;
alter table taste.verdicts add constraint verdicts_verdict_check check (verdict in ('taste_failure', 'somewhat', 'fine', 'unsure'));
