local restricted_maps = {
  [0] = true, -- vanilla
  [1] = true, -- vanilla
  [530] = true, -- BC
}

local allowed_zones = {
  [4378] = true, -- Dalaran Arena
  [4406] = true, -- The Ring of Valor
  [3968] = true, -- Ruins of Lordaeron
  [3702] = true, -- Blade's Edge Arena
  [3698] = true, -- Nagrand Arena
  [3277] = true, -- Warsong Gulch
}

local allowed_areas = {
  [3523] = { -- Netherstorm
    [3875] = true, -- Eco-Dome Skyperch
    [3876] = true, -- Eco-Dome Sutheron
    [3738] = true, -- Stormspire
  },
}

local AREA_STORMSPIRE = 3738
local AREA_GM_ISLAND  = 876

local function checkBotHoldingPen(player)
  if not player or not player:IsBot() then return false end
  if player:InBattleground() then return false end

  local BOT_MAP = 1
  local BOT_ZONE = 876
  local BOT_AREA = 876
  local BOT_PHASE = 4294967295

  player:SetFFA(false)
  player:SetPvP(false)
  player:SetSanctuary(true)

  if player:IsDead() then
    player:ResurrectPlayer(1.0, false)
  end

  if player:GetMapId() ~= BOT_MAP or player:GetZoneId() ~= BOT_ZONE or player:GetAreaId() ~= BOT_AREA then
    player:SetPhaseMask(BOT_PHASE, true)
    player:Teleport(BOT_MAP, 16227.795, 16400.201, -64.37884, 2.851726)
    return true
  end

  if player:GetPhaseMask() ~= BOT_PHASE then
    player:SetPhaseMask(BOT_PHASE, true)
  end

  return true
end

local function applySanctuary(eventId, delay, repeats, player)
  if not player then return end
  local areaId = player:GetAreaId()
  if player:InBattleground() or (areaId ~= AREA_STORMSPIRE and areaId ~= AREA_GM_ISLAND) then
    player:SetSanctuary(false)
  else
    player:SetFFA(false)
    player:SetPvP(false)
    player:SetSanctuary(true)
  end
end

local function scheduleSanctuary(player)
  -- Area updates run before the core applies its normal PvP-area state.
  player:RegisterEvent(applySanctuary, 100, 1)
end

function Teleport (map, x, y, z, o)
  return function (player) return player:Teleport(map, x, y, z, o) end
end

-- Map: 530 (Outland) Zone: 3523 (Netherstorm) Area: 3738 (The Stormspire)
local TeleportMainGraveyard = Teleport(530, 4370.4556, 3096.8328, 132.97714, 3.5827959)
local TeleportStartingZone  = Teleport(530, 4115.9697, 3058.874, 339.4637, 1.9342613)

function isPlayerAllowed(player)
  if player:IsGM() then return true end
  local map = player:GetMapId()
  if not restricted_maps[map] then return true end
  local zone = player:GetZoneId()
  if allowed_zones[zone] then return true end
  local areas = allowed_areas[zone]
  return areas ~= nil and areas[player:GetAreaId()]
end

-- local AURA_MIST = 54119 -- not working well, to fix or skip
local AURA_PREPARATION = 44521
local AURA_ASPHYXIATION = 71665
function resetCooldownInBattleground(player)
  if player:InBattleground() then
    player:SetSanctuary(false)
    if player:HasAura(AURA_PREPARATION) then
      player:RemoveArenaSpellCooldowns()
    end
  end
end

function restrictPlayerArea(player)
  if checkBotHoldingPen(player) then return end

  if isPlayerAllowed(player) then
    if player:HasAura(AURA_ASPHYXIATION) then
      player:RemoveAura(AURA_ASPHYXIATION)
      -- player:RemoveAura(AURA_MIST)
    end
    return
  end

  if not player:HasAura(AURA_ASPHYXIATION) then
    player:AddAura(AURA_ASPHYXIATION, player)
    -- player:AddAura(AURA_MIST, player)
  end
end

RegisterPlayerEvent(PLAYER_EVENT_ON_UPDATE_ZONE, function (event, player, zone, area)
  restrictPlayerArea(player)
  resetCooldownInBattleground(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_UPDATE_AREA, function (event, player, oldArea, newArea)
  restrictPlayerArea(player)
  scheduleSanctuary(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_MAP_CHANGE, function (event, player)
  if player then
    local areaId = player:GetAreaId()
    if player:InBattleground() or (areaId ~= AREA_STORMSPIRE and areaId ~= AREA_GM_ISLAND) then
      player:SetSanctuary(false)
    end
    checkBotHoldingPen(player)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_COMBAT, function (event, player)
  if player then
    player:SetSanctuary(false)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGIN, function (event, player)
  if checkBotHoldingPen(player) then return end
  scheduleSanctuary(player)
  if isPlayerAllowed(player) then return end
  if player:IsDead() then
    TeleportMainGraveyard(player)
  else
    TeleportStartingZone(player)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function (event, player)
  if checkBotHoldingPen(player) then return end
  if isPlayerAllowed(player) then return end
  TeleportMainGraveyard(player)
end)

RegisterServerEvent(ELUNA_EVENT_ON_LUA_STATE_OPEN, function (event)
  local players = GetPlayersInWorld()
  if not players then return end
  for _, p in ipairs(players) do checkBotHoldingPen(p) end
end)
