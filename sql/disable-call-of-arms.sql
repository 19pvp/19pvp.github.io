-- Disable Call of Arms / Call of War Battleground events
TRUNCATE TABLE `game_event_battleground_holiday`;
UPDATE `game_event` SET `holiday` = 0 WHERE `eventEntry` IN (18, 19, 20, 21, 53, 54);
