-- One-time: switch the historical default bolt material from SS to GI for every
-- flange whose MOC is not MS/CS. MILD STEEL (MS) and CARBON/CAST STEEL (CS) lock
-- their own material; all other MOCs now default to galvanized iron.
UPDATE "flange"
SET "boltWeight" = split_part("boltWeight", '|', 1) || '|GI'
WHERE "boltWeight" LIKE '%|SS'
  AND UPPER(TRIM("moc")) NOT IN
      ('MS', 'M.S.', 'CS', 'C.S.', 'MILD STEEL', 'CARBON STEEL', 'CAST STEEL');
