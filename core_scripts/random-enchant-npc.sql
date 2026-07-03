INSERT INTO `19pvp_world`.`creature_template`
  (`entry`, `difficulty_entry_1`, `difficulty_entry_2`, `difficulty_entry_3`, `KillCredit1`, `KillCredit2`, `name`, `subname`, `IconName`, `gossip_menu_id`, `minlevel`, `maxlevel`, `exp`, `faction`, `npcflag`, `speed_walk`, `speed_run`, `speed_swim`, `speed_flight`, `detection_range`, `rank`, `dmgschool`, `DamageModifier`, `BaseAttackTime`, `RangeAttackTime`, `BaseVariance`, `RangeVariance`, `unit_class`, `unit_flags`, `unit_flags2`, `dynamicflags`, `family`, `type`, `type_flags`, `lootid`, `pickpocketloot`, `skinloot`, `PetSpellDataId`, `VehicleId`, `mingold`, `maxgold`, `AIName`, `MovementType`, `HoverHeight`, `HealthModifier`, `ManaModifier`, `ArmorModifier`, `ExperienceModifier`, `RacialLeader`, `movementId`, `RegenHealth`, `CreatureImmunitiesId`, `flags_extra`, `ScriptName`, `VerifiedBuild`)
VALUES
  (777100, 0, 0, 0, 0, 0, 'Random Enchanter', 'Suffix Reforging', NULL, 0, 60, 60, 0, 1731, 1, 1, 1.14286, 1, 1, 20, 0, 0, 1, 2000, 2000, 1, 1, 1, 512, 2048, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, '', 1, 1, 1.25, 1, 1, 1, 0, 0, 1, 0, 2, '', 12340)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `subname` = VALUES(`subname`),
  `npcflag` = VALUES(`npcflag`);
