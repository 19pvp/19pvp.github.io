package.path = package.path .. ";lua_scripts/?.lua"

local starting_info = require('starting-info')


local BAG_ID = 14046
local INVENTORY_SLOT_BAG_START = 19
local INVENTORY_SLOT_BAG_END = 22
local ITEM_COUNTS = {
  [2515] = 200, -- Sharp Arrow
  [2516] = 200, -- Light Shot
}

local INVENTORY_TYPE_TO_SLOT = {
  [1] = 0,  -- head
  [2] = 1,  -- neck
  [3] = 2,  -- shoulders
  [4] = 3,  -- shirt
  [5] = 4,  -- chest
  [6] = 5,  -- waist
  [7] = 6,  -- legs
  [8] = 7,  -- feet
  [9] = 8,  -- wrists
  [10] = 9, -- hands
  [13] = 15, -- one-hand weapon
  [14] = 16, -- shield
  [15] = 17, -- bow
  [16] = 14, -- back
  [17] = 15, -- two-hand weapon
  [20] = 4,  -- robe
  [21] = 15, -- main hand
  [22] = 16, -- off hand
  [23] = 16, -- held in off hand
  [25] = 17, -- thrown
  [26] = 17, -- ranged right
  [28] = 17, -- relic
}

local function getItemEquipSlot(item)
  if item == nil or item.GetInventoryType == nil then return nil end
  return INVENTORY_TYPE_TO_SLOT[item:GetInventoryType()]
end

local function addStartingItem(player, item_id)
  local item = player:AddItem(item_id, ITEM_COUNTS[item_id] or 1)
  local slot = getItemEquipSlot(item)
  if slot == nil then return end

  local current = player:GetEquippedItemBySlot(slot)
  if current ~= nil then player:RemoveItem(current, 1) end
  player:EquipItem(item, slot)
end

RegisterPlayerEvent(PLAYER_EVENT_ON_FIRST_LOGIN, function (event, player)
  -- learn spells
  for _, spellId in pairs(starting_info.spells[player:GetClass()]) do
    player:LearnSpell(spellId)
  end

  -- add bags
  for i=INVENTORY_SLOT_BAG_START,INVENTORY_SLOT_BAG_END do
    player:EquipItem(player:AddItem(BAG_ID), i)
  end

  -- add items
  for _, item_id in pairs(starting_info.items[player:GetClass()]) do
    addStartingItem(player, item_id)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEVEL_CHANGE, function (event, player, oldLevel)
  player:AddBonusTalent(200)
  player:SendBroadcastMessage("You have gained 1 bonus talent point.")
end)
