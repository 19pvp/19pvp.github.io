-- This only runs when the server is down
UPDATE `19pvp_characters`.`characters` c
JOIN `19pvp_playerbots`.`playerbots_fixed_roster_guid` g ON g.`guid` = c.`guid`
JOIN `19pvp_playerbots`.`playerbots_fixed_roster` r ON r.`account` = g.`account`
SET c.`name` = r.`name`
WHERE c.`name` <> r.`name`;
