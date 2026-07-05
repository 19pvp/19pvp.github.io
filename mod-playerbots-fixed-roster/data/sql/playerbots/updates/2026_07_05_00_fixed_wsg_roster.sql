CREATE TABLE IF NOT EXISTS `playerbots_fixed_roster` (
  `guid` int unsigned NOT NULL,
  `team` tinyint unsigned NOT NULL,
  `slot` tinyint unsigned NOT NULL,
  `role` varchar(16) NOT NULL DEFAULT '',
  `enabled` tinyint(1) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`),
  UNIQUE KEY `team_slot` (`team`, `slot`),
  KEY `enabled` (`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
