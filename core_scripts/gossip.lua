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
local ICON_BOOK = 3
local ICON_INTERACT_COG = 4
local DUAL_SPEC_COST = 100000-- 10 Gold in copper

RegisterCreatureGossipEvent(22427, ON_HELLO, function(event, player, creature)
  player:GossipClearMenu()
  player:GossipMenuAddItem(ICON_INTERACT_COG, "Reset my talents", 1, 1, false, "Are you sure you want to reset your talents?")
  if player:GetSpecsCount() < 2 then
    player:GossipMenuAddItem(ICON_BOOK, "Learn Dual Specialization", 1, 2, false, "Are you sure you want to learn Dual Specialization?", DUAL_SPEC_COST)
  end
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
