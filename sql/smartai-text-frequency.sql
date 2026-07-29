-- Reduce SmartAI NPC talk actions to at most once per day where the event supports
-- a cooldown. Events without cooldown parameters are made non-repeatable until
-- the creature AI resets. 86400000 milliseconds = 24 hours.
--
-- This targets creature SmartAI (source_type 0) and SmartAI timed action lists
-- (source_type 9), not gameobject or other SmartAI sources.

-- Events whose cooldown/repeat values are stored in event_param3/4.
UPDATE `smart_scripts`
SET `event_param3` = 86400000,
    `event_param4` = 86400000
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` IN (0, 1, 2, 3, 8, 9, 10, 12, 14, 15, 16, 18, 23, 24, 26, 31, 32, 33, 38, 53, 60, 67, 74, 77, 105, 106, 110);

-- Events whose cooldown values are stored in event_param1/2.
UPDATE `smart_scripts`
SET `event_param1` = 86400000,
    `event_param2` = 86400000
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` IN (5, 13, 27, 28);

-- Events whose cooldown values are stored in event_param2/3.
UPDATE `smart_scripts`
SET `event_param2` = 86400000,
    `event_param3` = 86400000
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` IN (17, 19, 20, 22, 35, 45, 72, 82, 107);

-- Near-player events store their repeat values in event_param4/5.
UPDATE `smart_scripts`
SET `event_param4` = 86400000,
    `event_param5` = 86400000
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` IN (101, 102);

-- The distance events have one repeat value in event_param4.
UPDATE `smart_scripts`
SET `event_param4` = 86400000
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` IN (75, 76);

-- Remaining SmartAI talk triggers have no cooldown fields in smart_scripts.
-- Run them once per AI reset instead of on every matching trigger.
UPDATE `smart_scripts`
SET `event_flags` = `event_flags` | 1
WHERE `source_type` IN (0, 9)
  AND `action_type` IN (1, 84)
  AND `event_type` NOT IN (0, 1, 2, 3, 5, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 26, 27, 28, 31, 32, 33, 35, 38, 45, 53, 60, 67, 72, 74, 75, 76, 77, 82, 101, 102, 105, 106, 107, 110);
