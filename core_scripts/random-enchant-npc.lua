require("custom-data")

local random_enchant_db = custom_data.random_enchants

local NPC_RANDOM_ENCHANTER = 777100
local GOSSIP_TEXT = 777100
local ON_HELLO = 1
local ON_SELECT = 2

local ICON_GOSSIP = 7
local ITEM_MENU_SENDER = 100
local ENCHANT_MENU_SENDER = 101
local BACK_MENU_SENDER = 102
local ENCHANT_MENU_OFFSET = 1000

local ITEM_ICON_SIZE = 32
local QUALITY_COST_MULTIPLIER = {
  [0] = 1,
  [1] = 1,
  [2] = 2,
  [3] = 4,
  [4] = 8,
  [5] = 16,
  [6] = 32,
  [7] = 64,
}

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

-- WorldDBLoadFile("random-enchant-npc.sql")

local function itemIcon(item, size)
  local info = random_enchant_db.items[item:GetEntry()]
  if not info or not info.icon or info.icon == "" then return "" end
  return "|TInterface\\Icons\\"..info.icon..":"..size..":"..size..":0:0|t "
end

local function itemName(item)
  return item:GetName()
end

local function itemLabel(item)
  return itemIcon(item, ITEM_ICON_SIZE)..item:GetItemLink()
end

local function enchantCost(item)
  local multiplier = QUALITY_COST_MULTIPLIER[item:GetQuality()] or QUALITY_COST_MULTIPLIER[1]
  return math.max(10000, item:GetBuyPrice() * multiplier)
end

local function equippedRandomItems(player)
  local items = {}
  for _, slot in ipairs(EQUIPMENT_SLOTS) do
    local item = player:GetEquippedItemBySlot(slot)
    if item then
      local itemId = item:GetEntry()
      local info = random_enchant_db.items[itemId]
      local properties = info and (info.properties or {})
      if info and (#info.suffixes > 0 or #properties > 0) then
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
    player:SendBroadcastMessage("Equip an item with random suffix options first.")
    player:GossipComplete()
    return
  end

  for index, entry in ipairs(items) do
    player:GossipMenuAddItem(ICON_GOSSIP, itemLabel(entry.item), ITEM_MENU_SENDER, entry.slot)
  end
  player:GossipSendMenu(GOSSIP_TEXT, creature)
end

local function enchantMenu(info)
  local menu = {}
  local properties = info.properties or {}
  for _, suffixId in ipairs(info.suffixes) do
    table.insert(menu, { type = "suffix", id = suffixId, option = random_enchant_db.suffix_options[suffixId] })
  end
  for _, propertyId in ipairs(properties) do
    table.insert(menu, { type = "property", id = propertyId, option = random_enchant_db.property_options[propertyId] })
  end
  return menu
end

local function showSuffixes(player, creature, slot)
  local item = player:GetEquippedItemBySlot(slot)
  if not item then
    player:SendBroadcastMessage("That item is no longer equipped.")
    showItems(player, creature)
    return
  end

  local info = random_enchant_db.items[item:GetEntry()]
  local properties = info and (info.properties or {})
  if not info or (#info.suffixes == 0 and #properties == 0) then
    player:SendBroadcastMessage("That item has no generated suffix options.")
    showItems(player, creature)
    return
  end

  player:GossipClearMenu()
  local menu = enchantMenu(info)

  for index, entry in ipairs(menu) do
    local option = entry.option
    if option then
      player:GossipMenuAddItem(
        ICON_GOSSIP,
        option.name,
        ENCHANT_MENU_SENDER,
        ENCHANT_MENU_OFFSET + slot * 100 + index,
        false,
        "Apply "..option.name.." to "..itemName(item).."?",
        enchantCost(item)
      )
    end
  end
  player:GossipMenuAddItem(ICON_GOSSIP, "Back", BACK_MENU_SENDER, 0)
  player:GossipSendMenu(GOSSIP_TEXT, creature)
end

local function selectedEnchant(slot, intid)
  local index = intid - ENCHANT_MENU_OFFSET - slot * 100
  if index < 1 then return nil end
  return index
end

local function selectedSlot(intid)
  if intid < ENCHANT_MENU_OFFSET then return nil end
  return math.floor((intid - ENCHANT_MENU_OFFSET) / 100)
end

local function applyOption(player, creature, slot, entry)
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

  if not entry or not entry.option then
    player:SendBroadcastMessage("That random enchant is not available for this item.")
    showSuffixes(player, creature, slot)
    return
  end

  local allowed = false
  local ids = entry.type == "suffix" and info.suffixes or info.properties
  for _, allowedId in ipairs(ids) do
    if allowedId == entry.id then
      allowed = true
      break
    end
  end
  if not allowed then
    player:SendBroadcastMessage("That random enchant is not available for this item.")
    showSuffixes(player, creature, slot)
    return
  end

  local cost = enchantCost(item)
  if player:GetCoinage() < cost then
    player:SendBroadcastMessage("You do not have enough gold.")
    showSuffixes(player, creature, slot)
    return
  end

  player:ModifyMoney(-cost)

  if entry.type == "suffix" then
    item:SetRandomSuffix(entry.id)
  else
    item:SetRandomProperty(entry.id)
  end
  player:SendBroadcastMessage(itemName(item).." changed to "..entry.option.name..".")
  player:GossipComplete()
end

RegisterCreatureGossipEvent(NPC_RANDOM_ENCHANTER, ON_HELLO, function(event, player, creature)
  showItems(player, creature)
end)

RegisterCreatureGossipEvent(NPC_RANDOM_ENCHANTER, ON_SELECT, function(event, player, creature, sender, intid)
  if sender == BACK_MENU_SENDER then
    showItems(player, creature)
    return
  end

  if sender == ITEM_MENU_SENDER then
    showSuffixes(player, creature, intid)
    return
  end

  if sender == ENCHANT_MENU_SENDER then
    local slot = selectedSlot(intid)
    if not slot then
      showItems(player, creature)
      return
    end

    local item = player:GetEquippedItemBySlot(slot)
    if not item then
      showItems(player, creature)
      return
    end

    local info = random_enchant_db.items[item:GetEntry()]
    local menu = info and enchantMenu(info) or {}
    applyOption(player, creature, slot, menu[selectedEnchant(slot, intid)])
    return
  end

  showItems(player, creature)
end)
