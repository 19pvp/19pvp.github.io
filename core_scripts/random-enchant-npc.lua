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
local PAGE_MENU_SENDER = 103
local ENCHANT_MENU_OFFSET = 10000
local ITEMS_PER_PAGE = 20

local suffix_options = {
  -- Single stats
  [18] = { id = 18, name = "Agility" },
  [19] = { id = 19, name = "Intellect" },
  [15] = { id = 15, name = "Spirit" },
  [84] = { id = 84, name = "Stamina" },
  [17] = { id = 17, name = "Strength" },
  [27] = { id = 27, name = "Defense" },
  [26] = { id = 26, name = "Spell Power" },
  [20] = { id = 20, name = "Power (Attack Power)" },
  [99] = { id = 99, name = "Speed (Haste)" },
  -- Double stats
  [68] = { id = 68, name = "Bear (Strength / Stamina)" },
  [12] = { id = 12, name = "Boar (Spirit / Strength)" },
  [69] = { id = 69, name = "Eagle (Stamina / Intellect)" },
  [11] = { id = 11, name = "Falcon (Agility / Intellect)" },
  [10] = { id = 10, name = "Gorilla (Intellect / Strength)" },
  [78] = { id = 78, name = "Monkey (Agility / Stamina)" },
  [9]  = { id = 9,  name = "Owl (Intellect / Spirit)" },
  [14] = { id = 14, name = "Tiger (Agility / Strength)" },
  [81] = { id = 81, name = "Whale (Stamina / Spirit)" },
  [13] = { id = 13, name = "Wolf (Agility / Spirit)" },
  [47] = { id = 47, name = "Blocking (Block / Strength)" },
  [29] = { id = 29, name = "Eluding (Dodge / Agility)" },
  -- Tripple stats
  [71] = { id = 71, name = "Bandit (Agility / Attack Power / Stamina)" },
  [73] = { id = 73, name = "Elder (Intellect / Mana Per 5 sec. / Stamina)" },
  [50] = { id = 50, name = "Hunt (Attack Power / Agility / Intellect)" },
  [59] = { id = 59, name = "Moon (Intellect / Spirit / Stamina)" },
  -- Strenght
  [86] = { id = 86, name = "Soldier (Strength / Crit / Stamina)" },
  [74] = { id = 74, name = "Beast (Strength / Agility / Stamina)" },
  [75] = { id = 75, name = "Champion (Strength / Defense / Stamina)" },

  -- Caster
  [88] = { id = 88, name = "Foreseer (Spell Power / Intellect / Haste)" },
  [39] = { id = 39, name = "Invoker (Spell Power / Intellect / Crit)" },
  [77] = { id = 77, name = "Knight (Spell Power / Defense / Stamina)" },
  [38] = { id = 38, name = "Prophet (Spell Power /Intellect / Spirit)" },
  [57] = { id = 57, name = "Shadow (Attack Power, Agility / Stamina)" },
  [58] = { id = 58, name = "Sun (Spell Power / Intellect / Stamina)" },
}

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
  return 1 -- math.max(10000, item:GetBuyPrice() * multiplier)
end

local function equippedRandomItems(player)
  local items = {}
  for _, slot in ipairs(EQUIPMENT_SLOTS) do
    local item = player:GetEquippedItemBySlot(slot)
    if item then
      local itemId = item:GetEntry()
      local info = random_enchant_db.items[itemId]
      if info then
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

local CLASS_WARRIOR = 1
local CLASS_PALADIN = 2
local CLASS_HUNTER  = 3
local CLASS_ROGUE   = 4
local CLASS_PRIEST  = 5
local CLASS_SHAMAN  = 7
local CLASS_MAGE    = 8
local CLASS_WARLOCK = 9
local CLASS_DRUID   = 11

local CLASS_FILTER_KEYWORDS = {
  ["Agility"]      = { [CLASS_MAGE]=true, [CLASS_PRIEST]=true, [CLASS_WARLOCK]=true, [CLASS_PALADIN]=true },
  ["Attack Power"] = { [CLASS_WARRIOR]=true, [CLASS_PALADIN]=true, [CLASS_MAGE]=true, [CLASS_PRIEST]=true, [CLASS_WARLOCK]=true },
  ["Defense"]      = { [CLASS_HUNTER]=true, [CLASS_ROGUE]=true, [CLASS_PRIEST]=true, [CLASS_SHAMAN]=true, [CLASS_MAGE]=true, [CLASS_WARLOCK]=true, },
  ["Strength"]     = { [CLASS_SHAMAN]=true, [CLASS_MAGE]=true, [CLASS_PRIEST]=true, [CLASS_WARLOCK]=true, [CLASS_ROGUE]=true, [CLASS_HUNTER]=true },
  ["Block"]        = { [CLASS_DRUID]=true, [CLASS_MAGE]=true, [CLASS_PRIEST]=true, [CLASS_WARLOCK]=true, [CLASS_ROGUE]=true, [CLASS_HUNTER]=true },
  ["Intellect"]    = { [CLASS_ROGUE]=true, [CLASS_WARRIOR]=true },
  ["Spell Power"]  = { [CLASS_ROGUE]=true, [CLASS_WARRIOR]=true, [CLASS_HUNTER]=true },
}

local function isOptionAllowedForClass(optionName, playerClass)
  for keyword, restrictedClasses in pairs(CLASS_FILTER_KEYWORDS) do
    if string.find(optionName, keyword, 1, true) and restrictedClasses[playerClass] then
      return false
    end
  end
  return true
end

local function enchantMenu(info, playerClass)
  local menu = {}
  if info and info.properties then
    for _, propertyId in ipairs(info.properties) do
      local option = random_enchant_db.property_options[propertyId]
      if option and (not playerClass or isOptionAllowedForClass(option.name, playerClass)) then
        table.insert(menu, { type = "property", id = propertyId, option = option })
      end
    end
  else
    local keys = {}
    for id in pairs(suffix_options) do
      table.insert(keys, id)
    end
    table.sort(keys)
    for _, id in ipairs(keys) do
      local option = suffix_options[id]
      if option and (not playerClass or isOptionAllowedForClass(option.name, playerClass)) then
        table.insert(menu, { type = "suffix", id = id, option = option })
      end
    end
  end
  return menu
end

local function showSuffixes(player, creature, slot, page)
  page = page or 1
  local item = player:GetEquippedItemBySlot(slot)
  if not item then
    player:SendBroadcastMessage("That item is no longer equipped.")
    showItems(player, creature)
    return
  end

  local info = random_enchant_db.items[item:GetEntry()]
  if not info then
    player:SendBroadcastMessage("That item has no generated random options.")
    showItems(player, creature)
    return
  end

  local menu = enchantMenu(info, player:GetClass())
  local total = #menu
  if total == 0 then
    player:SendBroadcastMessage("No options available for this item.")
    showItems(player, creature)
    return
  end

  local maxPage = math.ceil(total / ITEMS_PER_PAGE)
  if maxPage < 1 then maxPage = 1 end
  page = math.max(1, math.min(page, maxPage))

  local startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  local endIndex = math.min(total, page * ITEMS_PER_PAGE)

  player:GossipClearMenu()

  for index = startIndex, endIndex do
    local entry = menu[index]
    local option = entry and entry.option
    if option then
      player:GossipMenuAddItem(
        ICON_GOSSIP,
        option.name,
        ENCHANT_MENU_SENDER,
        ENCHANT_MENU_OFFSET + slot * 1000 + index,
        false,
        "Apply "..option.name.." to "..itemName(item).."?",
        enchantCost(item)
      )
    end
  end

  if maxPage > 1 then
    local nextPage = (page >= maxPage) and 1 or (page + 1)
    local buttonText = (page >= maxPage) and "<< Previous Page" or "Next Page >>"
    player:GossipMenuAddItem(ICON_GOSSIP, buttonText, PAGE_MENU_SENDER, slot * 1000 + nextPage)
  end
  player:GossipMenuAddItem(ICON_GOSSIP, "Back", BACK_MENU_SENDER, 0)
  player:GossipSendMenu(GOSSIP_TEXT, creature)
end

local function selectedEnchant(slot, intid)
  local index = (intid - ENCHANT_MENU_OFFSET) - slot * 1000
  if index < 1 then return nil end
  return index
end

local function selectedSlot(intid)
  if intid < ENCHANT_MENU_OFFSET then return nil end
  return math.floor((intid - ENCHANT_MENU_OFFSET) / 1000)
end

local function applyOption(player, creature, slot, entry, page)
  local item = player:GetEquippedItemBySlot(slot)
  if not item then
    player:SendBroadcastMessage("That item is no longer equipped.")
    showItems(player, creature)
    return
  end

  local info = random_enchant_db.items[item:GetEntry()]
  if not info then
    player:SendBroadcastMessage("That item has no generated random options.")
    showItems(player, creature)
    return
  end

  if not entry or not entry.option then
    player:SendBroadcastMessage("That random enchant is not available for this item.")
    showSuffixes(player, creature, slot, page)
    return
  end

  local allowed = false
  if entry.type == "suffix" then
    allowed = (suffix_options[entry.id] ~= nil and isOptionAllowedForClass(entry.option.name, player:GetClass()))
  elseif info.properties then
    for _, allowedId in ipairs(info.properties) do
      if allowedId == entry.id and isOptionAllowedForClass(entry.option.name, player:GetClass()) then
        allowed = true
        break
      end
    end
  end

  if not allowed then
    player:SendBroadcastMessage("That random enchant is not available for this item.")
    showSuffixes(player, creature, slot, page)
    return
  end

  local cost = enchantCost(item)
  if player:GetCoinage() < cost then
    player:SendBroadcastMessage("You do not have enough gold.")
    showSuffixes(player, creature, slot, page)
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
    showSuffixes(player, creature, intid, 1)
    return
  end

  if sender == PAGE_MENU_SENDER then
    local slot = math.floor(intid / 1000)
    local page = intid % 1000
    showSuffixes(player, creature, slot, page)
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
    local menu = info and enchantMenu(info, player:GetClass()) or {}
    local enchantIndex = selectedEnchant(slot, intid)
    local page = math.ceil(enchantIndex / ITEMS_PER_PAGE)
    applyOption(player, creature, slot, menu[enchantIndex], page)
    return
  end

  showItems(player, creature)
end)
