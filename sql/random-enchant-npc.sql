INSERT INTO `creature_template`
  (`entry`, `difficulty_entry_1`, `difficulty_entry_2`, `difficulty_entry_3`, `KillCredit1`, `KillCredit2`, `name`, `subname`, `IconName`, `gossip_menu_id`, `minlevel`, `maxlevel`, `exp`, `faction`, `npcflag`, `speed_walk`, `speed_run`, `speed_swim`, `speed_flight`, `detection_range`, `rank`, `dmgschool`, `DamageModifier`, `BaseAttackTime`, `RangeAttackTime`, `BaseVariance`, `RangeVariance`, `unit_class`, `unit_flags`, `unit_flags2`, `dynamicflags`, `family`, `type`, `type_flags`, `lootid`, `pickpocketloot`, `skinloot`, `PetSpellDataId`, `VehicleId`, `mingold`, `maxgold`, `AIName`, `MovementType`, `HoverHeight`, `HealthModifier`, `ManaModifier`, `ArmorModifier`, `ExperienceModifier`, `RacialLeader`, `movementId`, `RegenHealth`, `CreatureImmunitiesId`, `flags_extra`, `ScriptName`, `VerifiedBuild`)
VALUES
  (777100, 0, 0, 0, 0, 0, 'Random Enchanter', 'Suffix Reforging', NULL, 777100, 60, 60, 0, 1731, 1, 1, 1.14286, 1, 1, 20, 0, 0, 1, 2000, 2000, 1, 1, 1, 512, 2048, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, '', 1, 1, 1.25, 1, 1, 1, 0, 0, 1, 0, 2, '', 12340)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `subname` = VALUES(`subname`),
  `npcflag` = VALUES(`npcflag`),
  `gossip_menu_id` = VALUES(`gossip_menu_id`);

INSERT INTO `creature_template_model`
  (`CreatureID`, `Idx`, `CreatureDisplayID`, `DisplayScale`, `Probability`, `VerifiedBuild`)
VALUES
  (777100, 0, 19956, 1, 1, 51831)
ON DUPLICATE KEY UPDATE
  `CreatureDisplayID` = VALUES(`CreatureDisplayID`),
  `DisplayScale` = VALUES(`DisplayScale`),
  `Probability` = VALUES(`Probability`);

INSERT INTO `npc_text`
  (`ID`, `text0_0`, `BroadcastTextID0`, `Probability0`, `VerifiedBuild`)
VALUES
  (777100, 'Greetings, $n. I can reforge random suffixes and properties on equipped items for one Emblem of Heroism.', 0, 1, 12340)
ON DUPLICATE KEY UPDATE
  `text0_0` = VALUES(`text0_0`),
  `Probability0` = VALUES(`Probability0`);

INSERT INTO `gossip_menu`
  (`MenuID`, `TextID`)
VALUES
  (777100, 777100)
ON DUPLICATE KEY UPDATE
  `TextID` = VALUES(`TextID`);
