print("gossip.lua loading starting...")

-- CreatureGossipEvents
local ON_HELLO = 1
local ON_SELECT = 2
local function BuildMenu(accumulator, menus)
  for key, options in pairs(menus) do
    if type(options) == 'table' then
      menus.menu = true
      options.intid = #accumulator + 1
      options.msg = key
      -- print(""..options.intid..": "..key)
      accumulator[options.intid] = options
      BuildMenu(accumulator, options)
    end
  end
end

local function AddGossipNpc(npc_id, gossips)
  RegisterCreatureGossipEvent(npc_id, ON_HELLO, function (event, player, creature)
    player:GossipClearMenu()
    local sender = 1
    for index, options in pairs(gossips) do
      player:GossipMenuAddItem(
        options.icon or 0,
        options.menu,
        sender,
        index,
        options.code or false,
        options.alert or nil,
        options.money or 0
      )
    end
    player:GossipSendMenu(sender, creature)
  end)
  RegisterCreatureGossipEvent(npc_id, ON_SELECT, function (event, player, creature, sender, intid, code, menu_id)
    gossips[intid].handler(player, creature, code, menu_id)
    player:GossipComplete()
  end)
end

local ICON_CHAT          = 0
local ICON_VENDOR        = 1
local ICON_TAXI          = 2
local ICON_BOOK          = 3 -- trainers
local ICON_INTERACT_COG  = 4
local ICON_VENDOR_GOLD   = 6
local ICON_GOSSIP        = 7
local ICON_GUILD_TABARD  = 8
local ICON_FIGHT         = 9
local ICON_DOT           = 10

local ENCHANT_ARCANUM_100HP = 1503 -- legs & head
local ENCHANT_ARCANUM_150MANA = 1483 -- legs & head
local ENCHANT_ARCANUM_8STR = 1506 -- legs & head
local ENCHANT_ARCANUM_8AGI = 1508 -- legs & head
local ENCHANT_ARCANUM_20FIRE = 1505 -- legs & head
local ENCHANT_ARCANUM_8SP = 2544 -- legs & head
local ENCHANT_30SP = 2504 -- weapon
local ENCHANT_LIFESTEAL = 1898 -- weapon
local ENCHANT_FIERY = 803 -- weapon
local ENCHANT_CRUSADER = 1900 -- weapon
local ENCHANT_22INT = 2568 -- weapon
local ENCHANT_20SPIRIT = 2567 -- weapon
local ENCHANT_15AGI_WEAPON = 2564 -- weapon
local ENCHANT_25AGI = 2646 -- weapon
local ENCHANT_SCOPE = 32 -- ranged weapon
local ENCHANT_9STAM = 1886 -- bracer
local ENCHANT_9STR = 1885 -- bracer
local ENCHANT_5MP5 = 2565 -- bracer
local ENCHANT_15SP = 2650 -- bracer
local ENCHANT_16SP = 2617 -- gloves
local ENCHANT_15AGI = 2564 -- gloves
local ENCHANT_7STR = 927 -- gloves
local ENCHANT_35SP_20STAM = 2746 -- legs
local ENCHANT_40STAM_12AGI = 3013 -- legs
local ENCHANT_50AP_12CRIT = 3012 -- legs
local ENCHANT_7STAM = 929 -- shield
local ENCHANT_7FROST = 926 -- shield
local ENCHANT_4MP5 = 1890 -- shield
local ENCHANT_4ALL = 1891 -- chest
local ENCHANT_100HP = 1892 -- chest
local ENCHANT_SPEED = 911 -- feet
local ENCHANT_70ARM = 1889 -- back
local ENCHANT_5ALLRES = 1888 -- back
local ENCHANT_10SHADOW = 804 -- back
local ENCHANT_15FIRE = 1354 -- back
local ENCHANT_15NATURE = 1400 -- back

local BiS = {
  [0] = {
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_100HP }, -- Lucky Fishing Hat
    { slot = SLOT_NECK, item_alliance = 20444, item_horde = 20442 }, -- Scout's Medallion
    { slot = SLOT_BACK, item = 45626, enchant = ENCHANT_5ALLRES }, -- Spidersilk Drape
    { slot = SLOT_FINGER1, item = 2933 }, -- Seal of Wyrn
    { slot = SLOT_FINGER2, item = 50255 }, -- Dread Pirate Ring
    { slot = SLOT_TRINKET1, item_alliance = 44098, item_horde = 44097 }, -- PvP Insigna
    { slot = SLOT_TRINKET2, item = 19024 }, -- AGM
    { slot = SLOT_NONE, item = 6414 }, -- Seal of Sylvanas
    { slot = SLOT_NONE, item = 19969, enchant = ENCHANT_SPEED }, -- Nat Pagle's Extreme Anglin' Boots
    { slot = SLOT_NONE, item = 45626, enchant = ENCHANT_10SHADOW }, -- Spidersilk Drape
    { slot = SLOT_NONE, item = 45626, enchant = ENCHANT_15FIRE }, -- Spidersilk Drape
    { slot = SLOT_NONE, item = 45626, enchant = ENCHANT_15NATURE }, -- Spidersilk Drape
    { slot = SLOT_NONE, item = 45626, enchant = ENCHANT_70ARM }, -- Spidersilk Drape
  },
  [WARRIOR] = {
    { slot = SLOT_MAINHAND, item = 1482, enchant = ENCHANT_LIFESTEAL }, -- Shadowfang
    { slot = SLOT_OFFHAND, item = 3761, enchant = ENCHANT_7STAM }, -- Deadskull Shield
    { slot = SLOT_SHOULDERS, item = 42949 }, -- Polished Spaulders of Valor 
    { slot = SLOT_CHEST, item = 48685, enchant = ENCHANT_4ALL }, -- Polished Breastplate of Valor
    { slot = SLOT_WRISTS, item = 14147, enchant = ENCHANT_9STR }, -- Cavedweller Bracers
    { slot = SLOT_HANDS, item = 12994, enchant = ENCHANT_7STR }, -- Thorbia's Gauntlets
    { slot = SLOT_WAIST, item = 6468 }, -- Deviate Scale Belt 
    { slot = SLOT_LEGS, item = 6087, enchant = ENCHANT_40STAM_12AGI }, -- Chausses of Westfall
    { slot = SLOT_FEET, item = 12982, enchant = ENCHANT_SPEED }, -- Silver-linked Footguards
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_CRUSADER }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_FIERY }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 5815, enchant = ENCHANT_FIERY }, -- Glacial Stone
    { slot = SLOT_NONE, item = 7002, enchant = ENCHANT_7FROST }, -- Arctic Buckler
    { slot = SLOT_NONE, item = 42946, enchant = ENCHANT_SCOPE }, -- Charmed Ancient Bone Bow
    { slot = SLOT_NONE, item = 29584 }, -- Throat Piercers
    { slot = SLOT_NONE, item = 29201 }, -- Thick Bronze Darts
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8STR }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 4534, enchant = ENCHANT_9STAM }, -- Steel-clasped Bracers
    { slot = SLOT_NONE, item = 12994, enchant = ENCHANT_15AGI }, -- Thorbia's Gauntlets
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
  },
  [PALADIN] = {
    { slot = SLOT_MAINHAND, item = 1482, enchant = ENCHANT_LIFESTEAL }, -- Shadowfang
    { slot = SLOT_OFFHAND, item = 3761, enchant = ENCHANT_7STAM }, -- Deadskull Shield
    { slot = SLOT_SHOULDERS, item = 42949 }, -- Polished Spaulders of Valor
    { slot = SLOT_CHEST, item = 48685, enchant = ENCHANT_4ALL }, -- Polished Breastplate of Valor
    { slot = SLOT_WRISTS, item = 14147, enchant = ENCHANT_9STR }, -- Cavedweller Bracers
    { slot = SLOT_HANDS, item = 12994, enchant = ENCHANT_7STR }, -- Thorbia's Gauntlets
    { slot = SLOT_WAIST, item = 6468 }, -- Deviate Scale Belt
    { slot = SLOT_LEGS, item = 6087, enchant = ENCHANT_40STAM_12AGI }, -- Chausses of Westfall
    { slot = SLOT_FEET, item = 12982, enchant = ENCHANT_SPEED }, -- Silver-linked Footguards
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_CRUSADER }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_FIERY }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 5815, enchant = ENCHANT_FIERY }, -- Glacial Stone
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_22INT }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_30SP }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_20SPIRIT }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 7002, enchant = ENCHANT_4MP5 }, -- Arctic Buckler
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8STR }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 42951 }, -- Mystical Pauldrons of Elements
    { slot = SLOT_NONE, item = 4534, enchant = ENCHANT_9STAM }, -- Steel-clasped Bracers
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_5MP5 }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_NONE, item = 6319 }, -- Girdle of the Blindwatcher
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
    { slot = SLOT_NONE, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [HUNTER] = {
    { slot = SLOT_MAINHAND, item = 42947, enchant = ENCHANT_22INT }, -- Dignified Headmaster's Charge
    { slot = SLOT_RANGED, item = 44093, enchant = ENCHANT_SCOPE }, -- Upgraded Dwarven Hand Cannon
    { slot = SLOT_SHOULDERS, item = 42950 }, -- Champion Herod's Shoulder
    { slot = SLOT_CHEST, item = 48677, enchant = ENCHANT_100HP }, -- Champion's Deathdealer Breastplate
    { slot = SLOT_WRISTS, item = 3202, enchant = ENCHANT_9STAM }, -- Forest Leather Bracers
    { slot = SLOT_HANDS, item = 10413, enchant = ENCHANT_15AGI }, -- Gloves of the Fang
    { slot = SLOT_WAIST, item = 6468 }, -- Deviate Scale Belt
    { slot = SLOT_LEGS, item = 10410, enchant = ENCHANT_40STAM_12AGI }, -- Leggings of the Fang
    { slot = SLOT_FEET, item = 10411, enchant = ENCHANT_SPEED }, -- Footpads of the Fang
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_25AGI }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 3415, enchant = ENCHANT_20SPIRIT }, -- Staff of the Friar
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_FIERY }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 5815, enchant = ENCHANT_FIERY }, -- Glacial Stone
    { slot = SLOT_NONE, item = 42946, enchant = ENCHANT_SCOPE }, -- Charmed Ancient Bone Bow
    { slot = SLOT_NONE, item = 6469, enchant = ENCHANT_SCOPE }, -- Venomstrike
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8AGI }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 42952 }, -- Stained Shadowcraft Spaulders
    { slot = SLOT_NONE, item = 48689, enchant = ENCHANT_100HP }, -- Stained Shadowcraft Tunic
    { slot = SLOT_NONE, item = 3202, enchant = ENCHANT_9STR }, -- Forest Leather Bracers
    { slot = SLOT_NONE, item = 3202, enchant = ENCHANT_5MP5 }, -- Forest Leather Bracers
    { slot = SLOT_NONE, item = 10413, enchant = ENCHANT_7STR }, -- Gloves of the Fang
    { slot = SLOT_NONE, item = 6319 }, -- Girdle of the Blindwatcher
    { slot = SLOT_NONE, item = 10403 }, -- Blackened Defias Belt
    { slot = SLOT_NONE, item = 16987 }, -- Screecher Belt  
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_40STAM_12AGI }, -- Smelting Pants
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
    { slot = SLOT_NONE, item = 10410, enchant = ENCHANT_50AP_12CRIT }, -- Leggings of the Fang
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [ROGUE] = {
    { slot = SLOT_MAINHAND, item = 1482, enchant = ENCHANT_15AGI_WEAPON }, -- Shadowfang
    { slot = SLOT_OFFHAND, item = 1482, enchant = ENCHANT_15AGI }, -- Shadowfang
    { slot = SLOT_RANGED, item = 29584 }, -- Throat Piercers
    { slot = SLOT_SHOULDERS, item = 42952 }, -- Stained Shadowcraft Spaulders
    { slot = SLOT_CHEST, item = 48689, enchant = ENCHANT_100HP }, -- Stained Shadowcraft Tunic
    { slot = SLOT_WRISTS, item = 3202, enchant = ENCHANT_9STAM }, -- Forest Leather Bracers
    { slot = SLOT_HANDS, item = 10413, enchant = ENCHANT_15AGI }, -- Gloves of the Fang
    { slot = SLOT_WAIST, item = 6468 }, -- Deviate Scale Belt
    { slot = SLOT_LEGS, item = 10410, enchant = ENCHANT_40STAM_12AGI }, -- Leggings of the Fang
    { slot = SLOT_FEET, item = 10411, enchant = ENCHANT_SPEED }, -- Footpads of the Fang
    { slot = SLOT_NONE, item = 1482, enchant = ENCHANT_FIERY }, -- Shadowfang
    { slot = SLOT_NONE, item = 1482, enchant = ENCHANT_FIERY }, -- Shadowfang
    { slot = SLOT_NONE, item = 1482, enchant = ENCHANT_LIFESTEAL }, -- Shadowfang
    { slot = SLOT_NONE, item = 1482, enchant = ENCHANT_LIFESTEAL }, -- Shadowfang
    { slot = SLOT_NONE, item = 1935, enchant = ENCHANT_FIERY }, -- Assassin's Blade
    { slot = SLOT_NONE, item = 1935, enchant = ENCHANT_5DMG }, -- Assassin's Blade
    { slot = SLOT_NONE, item = 1935, enchant = ENCHANT_15AGI_WEAPON }, -- Assassin's Blade
    { slot = SLOT_NONE, item = 42946, enchant = ENCHANT_SCOPE }, -- Charmed Ancient Bone Bow
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8AGI }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 48689, enchant = ENCHANT_4ALL }, -- Stained Shadowcraft Tunic
    { slot = SLOT_NONE, item = 3202, enchant = ENCHANT_9STR }, -- Forest Leather Bracers
    { slot = SLOT_NONE, item = 10403 }, -- Blackened Defias Belt
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
    { slot = SLOT_NONE, item = 10410, enchant = ENCHANT_50AP_12CRIT }, -- Leggings of the Fang
  },
  [PRIEST] = {
    { slot = SLOT_MAINHAND, item = 42948, enchant = ENCHANT_22INT }, -- Devout Aurastone Hammer
    { slot = SLOT_OFFHAND, item = 16768 }, -- Furbolg Medicine Pouch
    { slot = SLOT_RANGED, item = 7001 }, -- Gravestone Scepter
    { slot = SLOT_SHOULDERS, item = 42985 }, -- Tattered Dreadmist Mantle
    { slot = SLOT_CHEST, item = 48691, enchant = ENCHANT_100HP }, -- Tattered Dreadmist Robe
    { slot = SLOT_WRISTS, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_HANDS, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_WAIST, item = 2911 }, -- Keller's Girdle
    { slot = SLOT_LEGS, item = 12987, enchant = ENCHANT_35SP_20STAM }, -- Darkweave Breeches
    { slot = SLOT_FEET, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_30SP }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_20SPIRIT }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_22INT }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_30SP }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 3415, enchant = ENCHANT_20SPIRIT }, -- Staff of the Friar
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_22INT }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_30SP }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 44107 }, -- Exquisite Sunderseer Mantle
    { slot = SLOT_NONE, item = 2231, enchant = ENCHANT_100HP }, -- Infernal robe
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STAM }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_5MP5 }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 10043, enchant = ENCHANT_40STAM_12AGI }, -- Pious Legwraps
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [DEATHKNIGHT] = {
    { slot = SLOT_MAINHAND, item = 1482, enchant = ENCHANT_LIFESTEAL }, -- Shadowfang
    { slot = SLOT_SHOULDERS, item = 42949 }, -- Polished Spaulders of Valor 
    { slot = SLOT_CHEST, item = 48685, enchant = ENCHANT_4ALL }, -- Polished Breastplate of Valor
    { slot = SLOT_WRISTS, item = 14147, enchant = ENCHANT_9STR }, -- Cavedweller Bracers
    { slot = SLOT_HANDS, item = 12994, enchant = ENCHANT_7STR }, -- Thorbia's Gauntlets
    { slot = SLOT_WAIST, item = 6468 }, -- Deviate Scale Belt
    { slot = SLOT_LEGS, item = 6087, enchant = ENCHANT_40STAM_12AGI }, -- Chausses of Westfall
    { slot = SLOT_FEET, item = 12982, enchant = ENCHANT_SPEED }, -- Silver-linked Footguards
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_CRUSADER }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 42943, enchant = ENCHANT_FIERY }, -- Bloodied Arcanite Reaper
    { slot = SLOT_NONE, item = 5815, enchant = ENCHANT_FIERY }, -- Glacial Stone
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8STR }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 4534, enchant = ENCHANT_9STAM }, -- Steel-clasped Bracers
    { slot = SLOT_NONE, item = 12994, enchant = ENCHANT_15AGI }, -- Thorbia's Gauntlets
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
  },
  [SHAMAN] = {
    { slot = SLOT_MAINHAND, item = 42948, enchant = ENCHANT_22INT }, -- Devout Aurastone Hammer
    { slot = SLOT_OFFHAND, item = 7002, enchant = ENCHANT_4MP5 }, -- Arctic Buckler
    { slot = SLOT_SHOULDERS, item = 44107 }, -- Exquisite Sunderseer Mantle
    { slot = SLOT_CHEST, item = 48683, enchant = ENCHANT_100HP }, -- Mystical Vest of Elements
    { slot = SLOT_WRISTS, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_HANDS, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_WAIST, item = 6319 }, -- Girdle of the Blindwatcher
    { slot = SLOT_LEGS, item = 5199, enchant = ENCHANT_35SP_20STAM }, -- Smelting Pants
    { slot = SLOT_FEET, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_30SP }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_20SPIRIT }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 1935, enchant = ENCHANT_FIERY }, -- Assassin's Blade
    { slot = SLOT_NONE, item = 1935, enchant = ENCHANT_30SP }, -- Assassin's Blade
    { slot = SLOT_NONE, item = 3761, enchant = ENCHANT_7STAM }, -- Deadskull Shield
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 42951 }, -- Mystical Pauldrons of Elements
    { slot = SLOT_NONE, item = 2231, enchant = ENCHANT_100HP }, -- Infernal robe
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STAM }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_5MP5 }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 12987, enchant = ENCHANT_35SP_20STAM }, -- Darkweave Breeches
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_40STAM_12AGI }, -- Smelting Pants
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [MAGE] = {
    { slot = SLOT_MAINHAND, item = 44095, enchant = ENCHANT_22INT }, -- Grand Staff of Jordan 
    { slot = SLOT_RANGED, item = 7001 }, -- Gravestone Scepter
    { slot = SLOT_SHOULDERS, item = 44107 }, -- Exquisite Sunderseer Mantle
    { slot = SLOT_CHEST, item = 48691, enchant = ENCHANT_100HP }, -- Tattered Dreadmist Robe
    { slot = SLOT_WRISTS, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_HANDS, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_WAIST, item = 2911 }, -- Keller's Girdle
    { slot = SLOT_LEGS, item = 12987, enchant = ENCHANT_35SP_20STAM }, -- Darkweave Breeches
    { slot = SLOT_FEET, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_30SP }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 3415, enchant = ENCHANT_20SPIRIT }, -- Staff of the Friar
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_22INT }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_30SP }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 2231, enchant = ENCHANT_100HP }, -- Infernal robe
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STAM }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 10043, enchant = ENCHANT_40STAM_12AGI }, -- Pious Legwraps
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [WARLOCK] = {
    { slot = SLOT_MAINHAND, item = 44095, enchant = ENCHANT_22INT }, -- Grand Staff of Jordan 
    { slot = SLOT_RANGED, item = 7001 }, -- Gravestone Scepter
    { slot = SLOT_SHOULDERS, item = 44107 }, -- Exquisite Sunderseer Mantle
    { slot = SLOT_CHEST, item = 48691, enchant = ENCHANT_100HP }, -- Tattered Dreadmist Robe
    { slot = SLOT_WRISTS, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_HANDS, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_WAIST, item = 2911 }, -- Keller's Girdle
    { slot = SLOT_LEGS, item = 12987, enchant = ENCHANT_35SP_20STAM }, -- Darkweave Breeches
    { slot = SLOT_FEET, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_30SP }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 3415, enchant = ENCHANT_20SPIRIT }, -- Staff of the Friar
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_22INT }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_30SP }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 2231, enchant = ENCHANT_100HP }, -- Infernal robe
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STAM }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 10043, enchant = ENCHANT_40STAM_12AGI }, -- Pious Legwraps
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
  [DRUID] = {
    { slot = SLOT_MAINHAND, item = 42948, enchant = ENCHANT_22INT }, -- Devout Aurastone Hammer
    { slot = SLOT_OFFHAND, item = 16768 }, -- Furbolg Medicine Pouch
    { slot = SLOT_SHOULDERS, item = 42984 }, -- Preened Ironfeather Shoulders
    { slot = SLOT_CHEST, item = 48687, enchant = ENCHANT_100HP }, -- Preened Ironfeather Breastplate
    { slot = SLOT_WRISTS, item = 14148, enchant = ENCHANT_15SP }, -- Crystalline Cuffs
    { slot = SLOT_HANDS, item = 10654, enchant = ENCHANT_16SP }, -- Jutebraid Gloves
    { slot = SLOT_WAIST, item = 16608 }, -- Aquarius Belt
    { slot = SLOT_LEGS, item = 5199, enchant = ENCHANT_35SP_20STAM }, -- Smelting Pants
    { slot = SLOT_FEET, item = 4320, enchant = ENCHANT_SPEED }, -- Spidersilk Boots
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_30SP }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 42948, enchant = ENCHANT_20SPIRIT }, -- Devout Aurastone Hammer
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_22INT }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 44095, enchant = ENCHANT_30SP }, -- Grand Staff of Jordan
    { slot = SLOT_NONE, item = 3415, enchant = ENCHANT_20SPIRIT }, -- Staff of the Friar
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_22INT }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 42947, enchant = ENCHANT_30SP }, -- Dignified Headmaster's Charge
    { slot = SLOT_NONE, item = 5815, enchant = ENCHANT_FIERY }, -- Glacial Stone
    { slot = SLOT_NONE, item = 48718, enchant = ENCHANT_LIFESTEAL }, -- Repurposed Lava Dredger
    { slot = SLOT_NONE, item = 7230, enchant = ENCHANT_CRUSADER }, -- Smite's Mighty Hammer
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_8STR }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 19972, enchant = ENCHANT_ARCANUM_20FIRE }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_150MANA }, -- Lucky Fishing Hat
    { slot = SLOT_HEAD, item = 19972, enchant = ENCHANT_ARCANUM_8SP }, -- Lucky Fishing Hat
    { slot = SLOT_NONE, item = 44107 }, -- Exquisite Sunderseer Mantle
    { slot = SLOT_NONE, item = 42952 }, -- Stained Shadowcraft Spaulders
    { slot = SLOT_NONE, item = 48689, enchant = ENCHANT_100HP }, -- Stained Shadowcraft Tunic
    { slot = SLOT_NONE, item = 2231, enchant = ENCHANT_100HP }, -- Infernal robe
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STAM }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_9STR }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 14148, enchant = ENCHANT_5MP5 }, -- Crystalline Cuffs
    { slot = SLOT_NONE, item = 10413, enchant = ENCHANT_7STR }, -- Gloves of the Fang
    { slot = SLOT_NONE, item = 10413, enchant = ENCHANT_15AGI }, -- Gloves of the Fang
    { slot = SLOT_NONE, item = 6319 }, -- Girdle of the Blindwatcher
    { slot = SLOT_NONE, item = 12987, enchant = ENCHANT_35SP_20STAM }, -- Darkweave Breeches
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_40STAM_12AGI }, -- Smelting Pants
    { slot = SLOT_NONE, item = 10410, enchant = ENCHANT_40STAM_12AGI }, -- Leggings of the Fang
    { slot = SLOT_NONE, item = 5199, enchant = ENCHANT_50AP_12CRIT }, -- Smelting Pants
    { slot = SLOT_NONE, item = 10410, enchant = ENCHANT_50AP_12CRIT }, -- Leggings of the Fang
    { slot = SLOT_NONE, item = 6668, enchant = ENCHANT_SPEED }, -- Draftsman Boots
    { slot = SLOT_NONE, item_alliance = 20431, item_horde = 20426 }, -- WSG Ring
  },
}

function addEquipAndEnchantItem(player, entry)
  local itemId = entry.item or (player:GetTeam() == 1 and entry.item_horde) or entry.item_alliance
  if not (entry.slot == SLOT_NONE) then
  local item
  local current = player:GetEquippedItemBySlot(entry.slot)
    if current ~= nil then
      player:RemoveItem(current, 1)
    end
    item = player:AddItem(itemId)
    player:EquipItem(item, entry.slot)
  else
    item = player:AddItem(itemId)
  end
  if item ~= nil then
    if entry.enchant then
      item:SetEnchantment(entry.enchant, 0, 0)
    end
    if entry.suffix then
      item:SetRandomSuffix(entry.suffix)
    end
    if entry.property then
      item:SetRandomProperty(entry.property)
    end
  else
    print(inspect(entry)..' has no item !')
  end
end

local betaProviderGossip = {
  {
    menu = "Give me the good stuff",
    icon = ICON_VENDOR_GOLD,
    -- code = false, -- prompt an input to the player to enter a code
    -- alert = nil,  -- message to show
    -- money = 0,    -- amount to pay
    -- alert = "Are you sure ?",
    handler = function (player)
      -- If human, give an extra AGM
      for _, entry in ipairs(BiS[0]) do
        addEquipAndEnchantItem(player, entry)
      end
      for _, entry in ipairs(BiS[player:GetClass()]) do
        addEquipAndEnchantItem(player, entry)
      end
    end
  },
  {
    menu = "Reset my talents",
    icon = ICON_INTERACT_COG,
    alert = "Are you sure ?",
    handler = function (player)
      player:ResetTalents()
      player:ResetTalentsCost()
      player:SendBroadcastMessage("Reset talents")
    end
  },
  {
    menu = "Reset my cooldowns",
    icon = ICON_INTERACT_COG,
    handler = function (player)
      player:ResetAllCooldowns()
      player:SendBroadcastMessage("Reset cooldowns")
    end
  }
}

AddGossipNpc(55000, betaProviderGossip)
AddGossipNpc(55001, betaProviderGossip)

-- .reload creature_template 55000
-- UPDATE creature_template SET npcflag = npcflag | 1 WHERE entry = 55000;
print("gossip.lua loaded successfull.")

-- commit current file
-- ammend last commit
-- push --force-with-lease
-- reload eluna