local allowed_zones = {
  [4378] = true, -- Dalaran Arena
  [4406] = true, -- The Ring of Valor
  [3968] = true, -- Ruins of Lordaeron
  [3702] = true, -- Blade's Edge Arena
  [3698] = true, -- Nagrand Arena
  [3277] = true, -- Warsong Gulch
}

local allowed_areas = {
  [33] = { -- Stranglethorn
    [  35] = true, -- Booty Bay
    [  43] = true, -- Wild Shore
    [ 297] = true, -- Jaguero Isle
    [ 302] = true, -- The Crystal Shore
    [ 310] = true, -- Crystalvein Mine
    [ 311] = true, -- Ruins of Aboraz
    [ 312] = true, -- Janeiro's Point
    [ 477] = true, -- Ruins of Jubuwal
    [1577] = true, -- The Cape of Stranglethorn
    [1578] = true, -- Southern Savage Coast
    [1737] = true, -- Mistvale Valley
    [1738] = true, -- Nek'mani Wellspring
    [1739] = true, -- Bloodsail Compound
    [1741] = true, -- Gurubashi Arena
    [1742] = true, -- Spirit Den
    [2177] = true, -- Battle Ring
  },
  [721] = { [721] = true }, -- Gnomergan
  [719] = { [719] = true }, -- Blackfathom Deeps
  [331] = { -- Ashenvale
    [2897] = true, -- Zoram'gar Outpost
    [414] = true, -- The Zoram Strand
  },
  [17] = { -- The Barrens
    [392] = true, -- Ratchet
    [391] = true, -- The Merchant Coast
    [385] = true, -- Northwatch Hold
    [401] = true, -- The Tidus Stair
    [720] = true, -- Fray Island
  },
}

function Teleport (map, x, y, z, o)
  return function (player) return player:Teleport(map, x, y, z, o) end
end

-- Zone: 33 (Stranglethorn Vale) Area: 1577 (The Cape of Stranglethorn)
local TeleportMainGraveyard = Teleport(0, -14285, 288.447, 32.329372, 4.223945)

-- Zone: 33 (Stranglethorn Vale) Area: 35 (Booty Bay)
local TeleportStartingZone  = Teleport(0, -14284.343,  559.23016, 8.76681, 4.223945)


function isPlayerAllowed(player)
  local map = player:GetMapId()
  if map ~= 0 and map ~= 1 then return true end
  local zone = player:GetZoneId()
  if allowed_zones[zone] then return true end
  local areas = allowed_areas[zone]
  return areas ~= nil and areas[player:GetAreaId()]
end

local AURA_PREPARATION = 44521
local AURA_ASPHYXIATION = 71665
local AURA_MIST = 54119
function resetCooldownInBattleground(player)
  if player:InBattleground() and player:HasAura(AURA_PREPARATION) then
    player:RemoveArenaSpellCooldowns()
  end
end

function restrictPlayerArea(player)
  if isPlayerAllowed(player) then
    player:RemoveAura(AURA_ASPHYXIATION)
    player:RemoveAura(AURA_MIST)
    return
  end
  if not player:IsGM() and not player:GetMapId() ~= 0 then
    player:AddAura(AURA_ASPHYXIATION, player)
    player:AddAura(AURA_MIST, player)
  end
end

RegisterPlayerEvent(PLAYER_EVENT_ON_UPDATE_ZONE, function (event, player, zone, area)
  restrictPlayerArea(player)
  resetCooldownInBattleground(player)
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
  SendWebEvent('PVP_KILL', player, {
    victim = FormatPlayer(killed),
    map = player:GetMapId(),
    x = player:GetX(),
    y = player:GetY(),
    z = player:GetZ(),
  })
  killer:AddItem(5075) -- blood shard
end)

RegisterBGEvent(BG_EVENT_ON_END, function (event, bg, bgId, instanceId, winner)
  local mapId = bg:GetMapId()
  local map = GetMapById(mapId, instanceId)
  if not map then return end
  local tokenId = (map:IsArena() and 37836) or (map:isBattleground() and 20558)
  if not tokenId then return end
  for _, player in ipairs(map:GetPlayers()) do
    if player:GetTeam() == winner then
      player:AddItem(tokenId, 3)
    else
      player:AddItem(tokenId, 1)
    end
  end
end)

