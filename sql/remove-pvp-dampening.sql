-- Remove arena and battleground dampening auras.
DELETE FROM `spell_area` WHERE `spell` IN (74410, 74411);
