package.path = package.path .. ";/root/services/wow19/core_scripts/?.lua"

local starting_info = require('starting-info')

local SKILL_SKINNING = 393
local SKILL_MINING = 186
local SKILL_HERBALISM = 182
local SKILL_COOKING = 185
local SKILL_FIRST_AID = 129
local SKILL_FISHING = 356

local BAG_ID = 14046
local INVENTORY_SLOT_BAG_START = 19
local INVENTORY_SLOT_BAG_END = 22

RegisterPlayerEvent(PLAYER_EVENT_ON_FIRST_LOGIN, function (event, player)
  -- learn spells
  for _, spell in pairs(starting_info.spells[player:GetClass()]) do
    if spell.lvl == 15 then
      player:LearnSpell(spell.id)
    end
  end

  -- grant gathering skills
  player:LearnSpell(8613)
  player:LearnSpell(8617)
  player:LearnSpell(2575)
  player:LearnSpell(2576)
  player:LearnSpell(2366)
  player:LearnSpell(2368)

  -- set skills to 150
  player:SetSkill(SKILL_SKINNING, 150, 150, 150)
  player:SetSkill(SKILL_MINING, 150, 150, 150)
  player:SetSkill(SKILL_HERBALISM, 150, 150, 150)
  player:SetSkill(SKILL_COOKING, 150, 150, 150)
  player:SetSkill(SKILL_FIRST_AID, 150, 150, 150)
  player:SetSkill(SKILL_FISHING, 150, 150, 150)

  -- add bags
  for i=INVENTORY_SLOT_BAG_START,INVENTORY_SLOT_BAG_END do
    player:EquipItem(player:AddItem(BAG_ID), i)
  end
  player:AddBonusTalent(200)
  player:SendBroadcastMessage("You have gained 2 talent point.")
  player:SetLevel(15)

  -- add items
  for _, item_info in pairs(starting_info.items[player:GetClass()]) do
    local item = player:AddItem(item_info.item_id, item_info.item_id == nil and 200 or 1)
    if item_info.slot ~= nil then
      local current = player:GetEquippedItemBySlot(item_info.slot)
      if current ~= nil then
        player:RemoveItem(current, 1)
      end
      player:EquipItem(item, item_info.slot)
    end
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEVEL_CHANGE, function (event, player, oldLevel)
  player:AddBonusTalent(200)
  player:SendBroadcastMessage("You have gained 1 bonus talent point.")
end)
