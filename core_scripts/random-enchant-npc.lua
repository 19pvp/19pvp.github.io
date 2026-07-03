print("random-enchant-npc.lua loading starting...")

require("random-enchant-db")

print('random-enchant-db loaded')

local NPC_RANDOM_ENCHANTER = 777100
local ON_HELLO = 1
local ON_SELECT = 2

local ICON_CHAT = 0
local ICON_VENDOR_GOLD = 6
local ICON_DOT = 10

local ITEM_MENU_SENDER = 100
local SUFFIX_MENU_SENDER = 1000

local TOKEN_ITEM_ID = 0
local TOKEN_COST = 0

local EQUIPMENT_SLOTS = {
  SLOT_HEAD,
  SLOT_NECK,
  SLOT_SHOULDERS,
  SLOT_BODY,
  SLOT_CHEST,
  SLOT_WAIST,
  SLOT_LEGS,
  SLOT_FEET,
  SLOT_WRISTS,
  SLOT_HANDS,
  SLOT_FINGER1,
  SLOT_FINGER2,
  SLOT_TRINKET1,
  SLOT_TRINKET2,
  SLOT_BACK,
  SLOT_MAINHAND,
  SLOT_OFFHAND,
  SLOT_RANGED,
  SLOT_TABARD,
}

WorldDBLoadFile("random-enchant-npc.sql")

local function itemName(item)
  local ok, name = pcall(function() return item:GetName() end)
  if ok and name then return name end
  return "Item "..item:GetEntry()
end

local function canPay(player)
  if TOKEN_COST == 0 then return true end
  return TOKEN_ITEM_ID > 0 and player:HasItem(TOKEN_ITEM_ID, TOKEN_COST)
end

local function charge(player)
  if TOKEN_COST == 0 then return true end
  if not canPay(player) then return false end
  player:RemoveItem(TOKEN_ITEM_ID, TOKEN_COST)
  return true
end

local function equippedRandomItems(player)
  local items = {}
  for _, slot in ipairs(EQUIPMENT_SLOTS) do
    local item = player:GetEquippedItemBySlot(slot)
    if item then
      local itemId = item:GetEntry()
      local info = random_enchant_db.items[itemId]
      if info and #info.suffixes > 0 then
        table.insert(items, {
          slot = slot,
          item = item,
          itemId = itemId,
          info = info,
        })
      end
    end
  end
  return items
end

local function showItems(player, creature)
  player:GossipClearMenu()

  local items = equippedRandomItems(player)
  if #items == 0 then
    player:GossipMenuAddItem(ICON_CHAT, "Equip an item with random suffix options first.", 0, 0)
    player:GossipSendMenu(1, creature)
    return
  end

  for index, entry in ipairs(items) do
    player:GossipMenuAddItem(ICON_VENDOR_GOLD, itemName(entry.item), ITEM_MENU_SENDER, entry.slot)
  end
  player:GossipSendMenu(1, creature)
end

local function showSuffixes(player, creature, slot)
  local item = player:GetEquippedItemBySlot(slot)
  if not item then
    player:SendBroadcastMessage("That item is no longer equipped.")
    showItems(player, creature)
    return
  end

  local info = random_enchant_db.items[item:GetEntry()]
  if not info or #info.suffixes == 0 then
    player:SendBroadcastMessage("That item has no generated suffix options.")
    showItems(player, creature)
    return
  end

  player:GossipClearMenu()
  for _, suffixId in ipairs(info.suffixes) do
    local option = random_enchant_db.suffix_options[suffixId]
    if option then
      local label = option.name
      if TOKEN_COST > 0 then
        label = label.." - "..TOKEN_COST.." token"
      end
      player:GossipMenuAddItem(
        ICON_DOT,
        label,
        SUFFIX_MENU_SENDER + slot,
        suffixId,
        false,
        "Apply "..option.name.." to "..itemName(item).."?"
      )
    end
  end
  player:GossipMenuAddItem(ICON_CHAT, "Back", 0, 0)
  player:GossipSendMenu(1, creature)
end

local function applySuffix(player, creature, slot, suffixId)
  local item = player:GetEquippedItemBySlot(slot)
  if not item then
    player:SendBroadcastMessage("That item is no longer equipped.")
    showItems(player, creature)
    return
  end

  local info = random_enchant_db.items[item:GetEntry()]
  if not info then
    player:SendBroadcastMessage("That item has no generated suffix options.")
    showItems(player, creature)
    return
  end

  local allowed = false
  for _, allowedSuffixId in ipairs(info.suffixes) do
    if allowedSuffixId == suffixId then
      allowed = true
      break
    end
  end
  if not allowed then
    player:SendBroadcastMessage("That suffix is not available for this item.")
    showSuffixes(player, creature, slot)
    return
  end

  if not charge(player) then
    player:SendBroadcastMessage("You do not have enough tokens.")
    showSuffixes(player, creature, slot)
    return
  end

  item:SetRandomSuffix(suffixId)
  player:SendBroadcastMessage(itemName(item).." changed to "..random_enchant_db.suffix_options[suffixId].name..".")
  player:GossipComplete()
end

RegisterCreatureGossipEvent(NPC_RANDOM_ENCHANTER, ON_HELLO, function(event, player, creature)
  showItems(player, creature)
end)

RegisterCreatureGossipEvent(NPC_RANDOM_ENCHANTER, ON_SELECT, function(event, player, creature, sender, intid)
  if sender == ITEM_MENU_SENDER then
    showSuffixes(player, creature, intid)
  elseif sender >= SUFFIX_MENU_SENDER then
    applySuffix(player, creature, sender - SUFFIX_MENU_SENDER, intid)
  elseif sender == 0 and intid == 0 then
    showItems(player, creature)
  else
    showItems(player, creature)
  end
end)
