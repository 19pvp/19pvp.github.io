-- Keep herb and mining nodes visible, but prevent players from selecting them.
-- Azeroth Core GO_FLAG_NOT_SELECTABLE = 0x10.
-- Data0 is the Lock.dbc ID; this list contains locks requiring herbalism or mining.

INSERT INTO `gameobject_template_addon` (`entry`, `flags`)
SELECT `entry`, 16
FROM `gameobject_template`
WHERE `type` = 3
  AND `Data0` IN (
    8, 9, 10, 11, 18, 19, 20, 21, 22, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 38, 39, 40, 41, 42, 45, 47,
    48, 49, 50, 51, 259, 379, 380, 399, 400, 439, 440, 441, 442, 443, 444, 519, 521, 719, 939, 1119, 1120,
    1121, 1122, 1123, 1124, 1632, 1639, 1641, 1642, 1643, 1644, 1645, 1646, 1649, 1650, 1651, 1652, 1702,
    1713, 1714, 1771, 1775, 1782, 1783, 1784, 1785, 1786, 1787, 1788, 1789, 1790, 1791, 1792, 1793, 1800,
    1802, 1860
  )
ON DUPLICATE KEY UPDATE `flags` = `flags` | 16;
