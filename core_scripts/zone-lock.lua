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

local AURA_MIST = 54119
local AURA_PREPARATION = 44521
local AURA_ASPHYXIATION = 71665
function resetCooldownInBattleground(player)
  if player:InBattleground() and player:HasAura(AURA_PREPARATION) then
    player:RemoveArenaSpellCooldowns()
  end
end

function restrictPlayerArea(player)
  if isPlayerAllowed(player) then
    if player:HasAura(AURA_ASPHYXIATION) then
      player:RemoveAura(AURA_ASPHYXIATION)
      player:RemoveAura(AURA_MIST)
    end
    return
  end

  if not player:HasAura(AURA_ASPHYXIATION) then
    player:AddAura(AURA_ASPHYXIATION, player)
    player:AddAura(AURA_MIST, player)
  end
end

RegisterPlayerEvent(PLAYER_EVENT_ON_UPDATE_ZONE, function (event, player, zone, area)
  restrictPlayerArea(player)
  resetCooldownInBattleground(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_UPDATE_AREA, function (event, player, oldArea, newArea)
  restrictPlayerArea(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGIN, function (event, player)
  if isPlayerAllowed(player) then return end
  if player:IsDead() then
    TeleportMainGraveyard(player)
  else
    TeleportStartingZone(player)
  end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_COMMAND, function (event, player, command, chatHandler)
  if player == nil then return end
  -- SendWebEvent('COMMAND', player, { command = command })
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function (event, player)
  if isPlayerAllowed(player) then return end
  TeleportMainGraveyard(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_KILL_PLAYER, function (event, killer, killed)
  if killer:GetAccountId() == killed:GetAccountId() then return end
  if killer:InBattleground() or killer:InArena() then return end
  SendWebEvent('PVP_KILL', killer, {
    victim = FormatPlayer(killed),
    map = killed:GetMapId(),
    x = killed:GetX(),
    y = killed:GetY(),
    z = killed:GetZ(),
  })
  killer:AddItem(5075) -- blood shard
end)

RegisterBGEvent(BG_EVENT_ON_END, function (event, bg, bgId, instanceId, winner)
  local mapId = bg:GetMapId()
  local map = GetMapById(mapId, instanceId)
  if not map then return end
  local tokenId = (map:IsArena() and 37836) or (map:IsBattleground() and 20558)
  if not tokenId then return end
  for _, player in ipairs(map:GetPlayers()) do
    if player:GetTeam() == winner then
      player:AddItem(tokenId, 3)
    else
      player:AddItem(tokenId, 1)
    end
  end
end)
