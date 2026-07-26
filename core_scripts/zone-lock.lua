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
local players_sanctuary_state = {}
local function AddSanctuary(player)
  if not player then return end
  if players_sanctuary_state[player:GetGUIDLow()] then return end
  players_sanctuary_state[player:GetGUIDLow()] = true
  player:SetFFA(false)
  player:SetPvP(false)
  player:SetSanctuary(true)

  local pet = type(player.GetPet) == "function" and player:GetPet()
  if pet then
    pet:SetFFA(false)
    pet:SetPvP(false)
    pet:SetSanctuary(true)
  end
end

local function RemoveSanctuary(player)
  if not player then return end
  if not players_sanctuary_state[player:GetGUIDLow()] then return end
  players_sanctuary_state[player:GetGUIDLow()] = false
  local pet = type(player.GetPet) == "function" and player:GetPet()
  if pet then pet:SetSanctuary(false) end
end

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGOUT, function(event, player)
  if player then players_sanctuary_state[player:GetGUIDLow()] = nil end
end)

local function checkBotHoldingPen(player)
  if not player or not player:IsBot() then return false end
  if player:InBattleground() then return false end

  local BOT_MAP = 1
  local BOT_ZONE = 876
  local BOT_AREA = 876
  local BOT_PHASE = 4294967295

  AddSanctuary(player)

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

local STORMSPIRE_MIN_Z = 250.0 -- Adjust threshold for upper platform vs lower ground
local function isSanctuaryZone(player)
  if not player or player:InBattleground() then return false end
  local areaId = player:GetAreaId()
  local isInStormspire = areaId == AREA_STORMSPIRE and player:GetZ() >= STORMSPIRE_MIN_Z
  return isInStormspire or areaId == AREA_GM_ISLAND
end

local function updateSanctuaryState(player)
  if not player then return false end
  local sanctuary = isSanctuaryZone(player)
  local inCombat = type(player.IsInCombat) == "function" and player:IsInCombat()
  if sanctuary and not inCombat then
    AddSanctuary(player)
  else
    RemoveSanctuary(player)
  end
  return sanctuary
end

local function scheduleSanctuary(player)
  -- Area updates run before the core applies its normal PvP-area state.
  player:RegisterEvent(function (eventId, delay, repeats, player)
    updateSanctuaryState(player)
  end, 100, 1)
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
    RemoveSanctuary(player)
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
      RemoveSanctuary(player)
    end
    checkBotHoldingPen(player)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_COMBAT, function (_, player) updateSanctuaryState(player) end)
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_COMBAT, function (_, player) updateSanctuaryState(player) end)
RegisterPlayerEvent(PLAYER_EVENT_ON_PET_ADDED_TO_WORLD, function (event, player, pet)
  if not player or not pet then return end
  local areaId = player:GetAreaId()
  if not player:InBattleground() and (areaId == AREA_STORMSPIRE or areaId == AREA_GM_ISLAND or player:GetZoneId() == 876) then
    AddSanctuary(player)
  else
    RemoveSanctuary(player)
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

function resetCooldownIfSanctuary(event, player1, player2)
  if not isSanctuaryZone(player1) and not isSanctuaryZone(player2) then return end
  if player1 then player1:RemoveArenaSpellCooldowns() end
  if player2 then player2:RemoveArenaSpellCooldowns() end
end
RegisterPlayerEvent(PLAYER_EVENT_ON_DUEL_START, resetCooldownIfSanctuary)
RegisterPlayerEvent(PLAYER_EVENT_ON_DUEL_END, resetCooldownIfSanctuary)

RegisterServerEvent(ELUNA_EVENT_ON_LUA_STATE_OPEN, function (event)
  local players = GetPlayersInWorld()
  if not players then return end
  for _, p in ipairs(players) do checkBotHoldingPen(p) end
end)

local SPELL_SPEED_BOOST = 23451
local SPELL_PARACHUTE   = 44795
local SPELL_DESERTER_BG  = 26013
local SPELL_DESERTER_LFG = 71041
local DESERTER_DURATION_MS = 5 * 60 * 1000 -- 5 minutes (120,000 ms)

RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_APPLY, function(event, player, aura)
    if not player or not aura then return end
    if player:InBattleground() then return end
    local auraId = aura:GetAuraId()

    if auraId == SPELL_DESERTER_BG or auraId == SPELL_DESERTER_LFG then
      local duration = player:IsBot() and 1500 or DESERTER_DURATION_MS
      aura:SetDuration(duration)
      aura:SetMaxDuration(duration)
      return
    end

    if auraId ~= SPELL_SPEED_BOOST then return end

    print("[Rocket Boots Debug] Speed aura 23451 applied to " .. player:GetName())

    local pGuid = player:GetGUIDLow()
    local fallStartTime = nil

    local timerId
    timerId = CreateLuaEvent(function()
        local p = GetPlayerByGUID(pGuid)
        if not p or not p:HasAura(SPELL_SPEED_BOOST) then
            print("[Rocket Boots Debug] Speed aura 23451 ended or player offline for GUID " .. pGuid .. ", stopping timer.")
            RemoveEventById(timerId)
            return
        end

        local isFalling = p:IsFalling()
        if isFalling then
            local now = GetCurrTime()
            if not fallStartTime then
                fallStartTime = now
                print("[Rocket Boots Debug] " .. p:GetName() .. " started falling at time " .. now .. " (Z: " .. p:GetZ() .. ")")
            else
                local fallDuration = now - fallStartTime
                if fallDuration >= 3500 and not p:HasAura(SPELL_PARACHUTE) then
                    print("[Rocket Boots Debug] " .. p:GetName() .. " fell for " .. fallDuration .. "ms! Casting parachute " .. SPELL_PARACHUTE)
                    p:CastSpell(p, SPELL_PARACHUTE, true)
                end
            end
        else
            if fallStartTime then
                print("[Rocket Boots Debug] " .. p:GetName() .. " landed. Resetting fall timer.")
            end
            fallStartTime = nil
        end
    end, 100, 0)
end)

CreateLuaEvent(function()
  for _, player in ipairs(GetPlayersInWorld()) do
    updateSanctuaryState(player)
  end
end, 1000, 0)