print("gossip.lua loading starting...")

require("custom-data")

-- CreatureGossipEvents
local ON_HELLO = 1
local ON_SELECT = 2

function enchantItem(player, itemId, enchantId)
  local item = player:GetItemByEntry(itemId)
  if not item then return end
  item:SetEnchantment(enchantId, 0, 0)
end

-- Add quests triggers
RegisterPlayerEvent(PLAYER_EVENT_ON_COMPLETE_QUEST, function (event, player, quest, opt)
  local questId = quest:GetId()
  local spellId = custom_data.quest_reward_spells[questId]
  if spellId then
    player:LearnSpell(spellId)
    return
  end
  if questId == 777003 then -- Quest ENCHANT
    -- minor speed
    enchantItem(player, 14568, 911)
    enchantItem(player, 2910, 911)
    enchantItem(player, 1560, 911)
    -- 50 armor
    enchantItem(player, 3561, 884) --  Resilient Poncho
    -- fiery
    enchantItem(player, 4818, 803) --  Executioner's Sword
    enchantItem(player, 2046, 803) --  Bluegill Kukri
    enchantItem(player, 1459, 803) --  Shadowhide Scalper
    enchantItem(player, 6333, 803) --  Spikelash Dagger
    -- 9 intel
    enchantItem(player, 5749, 1904) --  Scythe Axe
    -- +2 damage
    enchantItem(player, 4369, 32)   --  Deadly Blunderbuss
    -- +10 crit
    enchantItem(player, 6467, 2934) --  Deviate Scale Gloves
    enchantItem(player, 892, 2934)  --  Gnoll Casting Gloves
    enchantItem(player, 5312, 2934) --  Riveted Gauntlets
    -- + 3 all stats
    enchantItem(player, 5317, 928) --  Dry Moss Tunic
    enchantItem(player, 3555, 928) --  Robe of Solomon
    enchantItem(player, 7336, 928) --  Wildwood Chain
    enchantItem(player, 3585, 928) --  Nature's Tunic
    -- + 5 stamina
    enchantItem(player, 1276, 852) --  Fire Hardened Buckler
    -- +7 stamina
    enchantItem(player, 1306, 929)  --  Wolfmane Wristguards
    enchantItem(player, 16981, 929) -- Owlbeard Bracers
    enchantItem(player, 14743, 929) -- Hulking Bands
    -- +30 spell
    enchantItem(player, 5627, 2504) --  Relic Blade
    enchantItem(player, 2035, 2504) --  Sword of the Night Sky
    return
  end
end)

local DUAL_SPEC_SPELL = 63645
local ICON_CHAT = 0
local ICON_VENDOR = 1
local ICON_BOOK = 3
local ICON_INTERACT_COG = 4
local ICON_MONEY_BAG = 6
local DUAL_SPEC_COST = 100000-- 10 Gold in copper

RegisterCreatureGossipEvent(22427, ON_HELLO, function(event, player, creature)
  player:GossipClearMenu()
  player:GossipMenuAddItem(ICON_INTERACT_COG, "Reset my talents", 1, 1, false, "Are you sure you want to reset your talents?")
  if player:GetSpecsCount() < 2 then
    player:GossipMenuAddItem(ICON_BOOK, "Learn Dual Specialization", 1, 2, false, "Are you sure you want to learn Dual Specialization?", DUAL_SPEC_COST)
  end
  player:GossipAddQuests(creature)
  player:GossipSendMenu(1, creature)
end)

RegisterCreatureGossipEvent(22427, ON_SELECT, function(event, player, creature, sender, intid)
  if intid == 1 then
    if player:IsInCombat() then
      player:SendBroadcastMessage("You cannot reset talents while in combat.")
    else
      player:ResetTalents()
      player:ResetTalentsCost()
      player:SendBroadcastMessage("Your talents have been reset.")
    end
  elseif intid == 2 then
    if player:GetSpecsCount() >= 2 then
      player:SendBroadcastMessage("You already have Dual Specialization.")
    elseif player:GetCoinage() < DUAL_SPEC_COST then
      player:SendBroadcastMessage("You do not have enough money to learn Dual Specialization (Requires 10 Gold).")
    else
      player:ModifyMoney(-DUAL_SPEC_COST)
      player:CastSpell(player, 63624, true)
      player:SendBroadcastMessage("You have learned Dual Specialization.")
    end
  end
  player:GossipComplete()
end)

local NPC_ITEM_VENDOR = 20205
local VENDOR_MENU_SENDER = 20205
local EXCHANGE_MENU_SENDER = 20206
local HONOR_EXCHANGE_COST = 1000
local ARENA_POINTS_REWARD = 10
local ARENA_EXCHANGE_COST = 100
local HONOR_POINTS_REWARD = 5000
local ITEM_WSG_MARK = 29434
local ITEM_ARENA_MARK = 40752

local TEXTURE_HONOR = "Interface\\Icons\\PVPCurrency-Honor-Alliance"
local TEXTURE_ARENA_POINTS = "Interface\\PVPFrame\\PVP-ArenaPoints-Icon"
local TEXTURE_BADGE_JUSTICE = "Interface\\Icons\\Spell_Holy_ChampionsBond"
local TEXTURE_EMBLEM_HEROISM = "Interface\\Icons\\Spell_Holy_ProclaimChampion"

local function inlineIcon(texture, size)
  size = size or 24
  return "|T" .. texture .. ":" .. size .. ":" .. size .. ":0:0|t "
end

local function showVendorMainMenu(player, creature)
  player:GossipClearMenu()
  player:GossipAddQuests(creature)
  player:GossipMenuAddItem(ICON_VENDOR, "Browse my heirlooms", VENDOR_MENU_SENDER, 1)
  player:GossipMenuAddItem(ICON_CHAT, "Currency Exchange", EXCHANGE_MENU_SENDER, 1)
  player:GossipSendMenu(1, creature)
end

local function showCurrencyExchangeMenu(player, creature)
  player:GossipClearMenu()
  player:GossipMenuAddItem(ICON_CHAT, inlineIcon(TEXTURE_ARENA_POINTS) .. "Convert 1000 Honor to 10 Arena Points", EXCHANGE_MENU_SENDER, 2)
  player:GossipMenuAddItem(ICON_CHAT, inlineIcon(TEXTURE_HONOR) .. "Convert 100 Arena Points to 5000 Honor", EXCHANGE_MENU_SENDER, 3)
  player:GossipMenuAddItem(ICON_CHAT, inlineIcon(TEXTURE_EMBLEM_HEROISM) .. "Convert 1 Badge of Justice to 1 Emblem of Heroism", EXCHANGE_MENU_SENDER, 4)
  player:GossipMenuAddItem(ICON_CHAT, inlineIcon(TEXTURE_BADGE_JUSTICE) .. "Convert 2 Emblems of Heroism to 1 Badge of Justice", EXCHANGE_MENU_SENDER, 5)
  player:GossipMenuAddItem(ICON_CHAT, "<- Back", VENDOR_MENU_SENDER, 0)
  player:GossipSendMenu(1, creature)
end

RegisterCreatureGossipEvent(NPC_ITEM_VENDOR, ON_HELLO, function(event, player, creature)
  showVendorMainMenu(player, creature)
  return true
end)

RegisterCreatureGossipEvent(NPC_ITEM_VENDOR, ON_SELECT, function(event, player, creature, sender, intid)
  if sender == VENDOR_MENU_SENDER then
    if intid == 0 then
      showVendorMainMenu(player, creature)
      return true
    elseif intid == 1 then
      player:SendListInventory(creature)
      return true
    end
  elseif sender == EXCHANGE_MENU_SENDER then
    if intid == 1 then
      showCurrencyExchangeMenu(player, creature)
      return true
    elseif intid == 2 then
      if player:GetHonorPoints() < HONOR_EXCHANGE_COST then
        player:SendBroadcastMessage("You do not have enough Honor Points (Requires 1000 Honor).")
      else
        player:ModifyHonorPoints(-HONOR_EXCHANGE_COST)
        player:ModifyArenaPoints(ARENA_POINTS_REWARD)
        player:SendBroadcastMessage("Exchanged 1000 Honor Points for 10 Arena Points.")
      end
      showCurrencyExchangeMenu(player, creature)
      return true
    elseif intid == 3 then
      if player:GetArenaPoints() < ARENA_EXCHANGE_COST then
        player:SendBroadcastMessage("You do not have enough Arena Points (Requires 100 Arena Points).")
      else
        player:ModifyArenaPoints(-ARENA_EXCHANGE_COST)
        player:ModifyHonorPoints(HONOR_POINTS_REWARD)
        player:SendBroadcastMessage("Exchanged 100 Arena Points for 5000 Honor Points.")
      end
      showCurrencyExchangeMenu(player, creature)
      return true
    elseif intid == 4 then
      if not player:HasItem(ITEM_WSG_MARK, 1) then
        player:SendBroadcastMessage("You do not have a Badge of Justice.")
      else
        player:RemoveItem(ITEM_WSG_MARK, 1)
        player:AddItem(ITEM_ARENA_MARK, 1)
        player:SendBroadcastMessage("Exchanged 1 Badge of Justice for 1 Emblem of Heroism.")
      end
      showCurrencyExchangeMenu(player, creature)
      return true
    elseif intid == 5 then
      if not player:HasItem(ITEM_ARENA_MARK, 2) then
        player:SendBroadcastMessage("You do not have enough Emblems of Heroism (Requires 2 Emblems of Heroism).")
      else
        player:RemoveItem(ITEM_ARENA_MARK, 2)
        player:AddItem(ITEM_WSG_MARK, 1)
        player:SendBroadcastMessage("Exchanged 2 Emblems of Heroism for 1 Badge of Justice.")
      end
      showCurrencyExchangeMenu(player, creature)
      return true
    end
  end
  return false
end)

