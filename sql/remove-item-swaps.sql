-- Remove the Talisman of the Alliance <-> Talisman of the Horde exchange.
DELETE FROM `player_factionchange_items` WHERE `alliance_id` = 25829 AND `horde_id` = 24551;
