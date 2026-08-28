local classColors = {
  [1] = "|cFFC69B6D", -- "Warrior"
  [2] = "|cFFF48CBA", -- Paladin
  [3] = "|cFFAAD372", -- Hunter
  [4] = "|cFFFFF468", -- Rogue
  [5] = "|cFFFFFFFF", -- Priest
  [6] = "|cFFC41E3A", -- Death Knight
  [7] = "|cFF0070DD", -- Shaman
  [8] = "|cFF3FC7EB", -- Mage
  [9] = "|cFF8788EE", -- Warlock
  [10] = "|cFF00FF98", -- Monk
  [11] = "|cFFFF7C0A", -- Druid
  [12] = "|cFFA330C9", -- Demon Hunter
  [13] = "|cFF33937F", -- Evoker
}

local SATCHEL_ITEM_ID = 51999
local WSG_BADGE_ITEM_ID = 29434
local ARENA_BADGE_ITEM_ID = 40752
local WsgState = require("wsg-state")
local wsgState = WsgState.shared

local function giveBadges(player, itemId, count)
  local before = player:GetItemCount(itemId, true)
  local item = player:CreateItem(itemId, count)
  local total = player:GetItemCount(itemId, true)
  return math.max(0, total - before), total, item ~= nil
end

local arenaTeamDefinitions = {
  { type = 2, suffix = " 2v2" },
  { type = 3, suffix = " 3v3" },
  { type = 5, suffix = " Battleground" },
}

local function ensureArenaTeams(player)
  local playerName = player:GetName()
  for _, definition in ipairs(arenaTeamDefinitions) do
    -- if not player:IsInArenaTeam(definition.type) then
      player:CreateArenaTeam(definition.type, playerName .. definition.suffix)
    end
  -- end
end

AuthDBQuery([[
CREATE TABLE IF NOT EXISTS discord_account (
  discord_id    BIGINT UNSIGNED PRIMARY KEY,
  discord_login VARCHAR(255) NOT NULL,
  account_id    INT UNSIGNED DEFAULT NULL,
  FOREIGN KEY (account_id) REFERENCES account(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
]])

local discord_logins = {}
RegisterPlayerEvent(PLAYER_EVENT_ON_LOGIN, function (event, player)
  if player:IsBot() then return end
  ensureArenaTeams(player)

  local account_id = player:GetAccountId()
  AuthDBQueryAsync(
    "SELECT discord_login FROM discord_account WHERE account_id="
    ..tostring(account_id), function (result)
    if not result then
      return
    end
    local discord_login = result:GetString(0)
    discord_logins[account_id] = discord_login
  end)
end)

function getDiscordName(account_id)
  local cached = discord_logins[account_id]
  if cached then return cached end
  local result = AuthDBQuery("SELECT discord_login FROM discord_account WHERE account_id="..tostring(account_id))
  if not result then return end
  local discord_login = result:GetString(0)
  discord_logins[account_id] = discord_login
  return discord_login
end

RegisterPlayerEvent(PLAYER_EVENT_ON_CHANNEL_CHAT, function(event, player, msg, Type, lang, channel)
  if player:IsBot() then return end
  if channel == 1 then
    -- Send message to players of both factions in the channel
    SendWebEvent('GENERAL_CHANNEL_MESSAGE', player, {
      message = msg:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("^%s+", ""):gsub("%s+$", "")
    })

    local classColor = classColors[player:GetClass()] or "|c9B59B600" 
    local login = getDiscordName(player:GetAccountId()) or player:GetAccountName()
    local fullMsg = classColor.."@"..login.."|r "..msg
    SendChannelMessage("General", fullMsg, 2, 0, player or account_id)
    return false -- Prevents the message from duplicating in the original chat
  end
end)

AuthDBQuery([[
CREATE TABLE IF NOT EXISTS discord_message (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  world_id    INT NOT NULL DEFAULT 1,
  discord_id  BIGINT UNSIGNED NOT NULL,
  message     VARCHAR(255) NOT NULL,
  FOREIGN KEY (discord_id) REFERENCES discord_account(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
]])

local query_check_new_messages = string.format([[
SELECT discord_message.id, discord_account.discord_login, discord_account.account_id, message
FROM discord_message
LEFT JOIN discord_account ON discord_message.discord_id = discord_account.discord_id
WHERE world_id = %d
LIMIT 10
]], GetRealmID())

function GetActivePlayerForAccount(account_id)
  for _, player in ipairs(GetPlayersInWorld()) do
    if player:GetAccountId() == account_id then return player end
  end
end

function getPlayerNameLink(player)
  local classColor = classColors[player:GetClass()] or "|cFFFFFFFF" 
  local name = player:GetName()
  return classColor.."|Hplayer:"..name.."|h"..name.."|h|r"
end

function ReplaceDiscordMentions(account_id, login)
  local player = GetActivePlayerForAccount(tonumber(account_id))
  if player then return getPlayerNameLink(player) end
  return "|c9B59B600@"..login.."|r"
end

function DisplayNewMessages(result)
  if not result then return end
  repeat
    local message_id = result:GetUInt32(0)
    local login = not result:IsNull(1) and result:GetString(1) or nil
    local account_id = not result:IsNull(2) and result:GetUInt32(2) or 0
    local msg = result:GetString(3)
    
    -- Delete from DB first to prevent duplicate processing if Lua error occurs during broadcast
    AuthDBQuery("DELETE FROM discord_message WHERE id = "..tostring(message_id))
    local player = account_id > 0 and GetActivePlayerForAccount(account_id) or nil
    local classColor = (player and classColors[player:GetClass()]) or "|c9B59B600" 
    local fullMsg = (login and (classColor.."@"..login.."|r ") or "")..msg:gsub("<@(%d+):([^>]+)>", ReplaceDiscordMentions)
    SendChannelMessage("General", fullMsg, 2, 0, player or account_id)
  until not result:NextRow()
end

local elapsed = 500
ClearServerEvents(WORLD_EVENT_ON_UPDATE)
RegisterServerEvent(WORLD_EVENT_ON_UPDATE, function (event, diff)
  elapsed = elapsed + diff
  if elapsed < 500 then return end
  elapsed = 0
  AuthDBQueryAsync(query_check_new_messages, DisplayNewMessages)
end)

local BLACKLISTED_FIRST_WORDS = {
  "info",
  "talent",
  "reload",
  "lookup",
  "list",
  "spellinfo",
  "commands",
  "help",
  "gps",
  "who",
  "teleport",
  "appear",
  "account",
}

local BLACKLISTED_SUB_COMMANDS = {
  ["gm"] = { "on", "off", "list", "ingame" },
  ["server"] = { "info", "motd" },
  ["npc"] = { "info" },
  ["gobject"] = { "info" },
  ["item"] = { "info" },
  ["guild"] = { "info" },
  ["character"] = { "info" },
}

local function isCommandBlacklisted(command)
  local cmd_lower = command:lower()
  
  local first_word, second_word = cmd_lower:match("^(%S+)%s*(%S*)")
  if not first_word then return false end

  for _, bw in ipairs(BLACKLISTED_FIRST_WORDS) do
    if bw:sub(1, #first_word) == first_word then
      return true
    end
  end

  for main_cmd, sub_cmds in pairs(BLACKLISTED_SUB_COMMANDS) do
    if main_cmd:sub(1, #first_word) == first_word then
      if second_word and #second_word > 0 then
        for _, sub_cmd in ipairs(sub_cmds) do
          if sub_cmd:sub(1, #second_word) == second_word then
            return true
          end
        end
      end
    end
  end

  return false
end

RegisterPlayerEvent(PLAYER_EVENT_ON_COMMAND, function (event, player, command, chatHandler)
  if player == nil then return end
  if player:IsBot() then return end
  if not player:IsGM() then return end

  if isCommandBlacklisted(command) then
    return
  end

  SendWebEvent('COMMAND', player, { command = command })
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_KILL_PLAYER, function (event, killer, killed)
  if killer:IsBot() then return end
  if killed:IsBot() then return end
  if killer:GetAccountId() == killed:GetAccountId() then return end
  if killer:InBattleground() or killer:InArena() then return end
  SendWebEvent('PVP_KILL', killer, {
    victim = FormatPlayer(killed),
    map = killed:GetMapId(),
    x = killed:GetX(),
    y = killed:GetY(),
    z = killed:GetZ(),
  })
  -- killer:AddItem(5075) -- blood shard
end)

RegisterBGEvent(BG_EVENT_ON_END, function (event, bg, bgId, instanceId, winner)
  print(string.format(
    "[WSG Reward Debug] BG end hook received { bgPresent: %s, bgId: %s, instanceId: %s, winner: %s }",
    tostring(bg ~= nil), tostring(bgId), tostring(instanceId), tostring(winner)
  ))
  if not bg or not instanceId or instanceId <= 0 then
    print("[WSG Reward Debug] BG end hook ignored: missing battleground or instance")
    return
  end

  local mapId = bg:GetMapId()
  local map = GetMapById(mapId, instanceId)
  local isWsg = mapId == 489
  local mapIsBattleground = map and map:IsBattleground() or false
  local mapIsArena = map and map:IsArena() or false
  if not isWsg and not map then
    print(string.format(
      "[WSG Reward Debug] End reward skipped: map unavailable { instanceId: %s, mapId: %s }",
      tostring(instanceId), tostring(mapId)
    ))
    return
  end

  print(string.format(
    "[WSG Reward Debug] End reward callback scheduled { instanceId: %s, mapId: %s, isWsg: %s, mapAvailable: %s }",
    tostring(instanceId), tostring(mapId), tostring(isWsg), tostring(map ~= nil)
  ))

  -- Metrics finalize on the same BG_END event. Defer one tick so the reward
  -- decision sees the final participation snapshot.
  CreateLuaEvent(function()
    print(string.format(
      "[WSG Reward Debug] Reward callback entered { instanceId: %s, isWsg: %s }",
      tostring(instanceId), tostring(isWsg)
    ))
    local claimed = WsgState.claimEndRewards(wsgState, instanceId)
    print(string.format(
      "[WSG Reward Debug] End reward pass { instanceId: %s, mapId: %s, winner: %s, claimed: %s }",
      tostring(instanceId), tostring(mapId), tostring(winner), tostring(claimed)
    ))
    if not claimed then return end

    local participants = WsgState.getParticipants(wsgState, instanceId)
    local participantCount = 0
    for _ in pairs(participants) do participantCount = participantCount + 1 end
    print(string.format(
      "[WSG Reward Debug] Reward target { instanceId: %s, mapId: %s, isWsg: %s, mapIsBattleground: %s, mapIsArena: %s, participants: %s }",
      tostring(instanceId), tostring(mapId), tostring(isWsg),
      tostring(mapIsBattleground), tostring(mapIsArena), tostring(participantCount)
    ))

    if isWsg then
      local rewarded = 0
      local skipped = 0
      WsgState.forEachParticipants(wsgState, instanceId, function(player, participant)
        local status = WsgState.getParticipationStatus(participant, participant.team == winner)
        if not status.eligible then
          print(string.format(
            "[Reward] Badges rejected { match: WSG, instanceId: %s, player: %s, guidLow: %s, reason: %s, score: %.2f, required: %.2f, total: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            tostring(status.reason), status.score, status.requiredScore,
            tostring(player:GetItemCount(WSG_BADGE_ITEM_ID, true))
          ))
          skipped = skipped + 1
          return
        end

        local satchel = player:AddItem(SATCHEL_ITEM_ID, 1)
        local count = participant.team == winner and 2 or 1
        local badges, total, added = giveBadges(player, WSG_BADGE_ITEM_ID, count)
        if badges > 0 then
          print(string.format(
            "[Reward] Badges granted { match: WSG, instanceId: %s, player: %s, guidLow: %s, count: %s, total: %s, satchelAdded: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            tostring(badges), tostring(total), tostring(satchel ~= nil)
          ))
          rewarded = rewarded + 1
        else
          print(string.format(
            "[Reward] Badges rejected { match: WSG, instanceId: %s, player: %s, guidLow: %s, reason: %s, total: %s, satchelAdded: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            added and "badge_count_unchanged" or "add_item_failed",
            tostring(total), tostring(satchel ~= nil)
          ))
          skipped = skipped + 1
        end
      end, function(participant)
        local status = WsgState.getParticipationStatus(participant, participant.team == winner)
        print(string.format(
          "[Reward] Badges rejected { match: WSG, instanceId: %s, player: %s, guidLow: %s, reason: %s }",
          tostring(instanceId), tostring(participant.name), tostring(participant.guidLow),
          status.eligible and "player_unavailable" or tostring(status.reason)
        ))
        skipped = skipped + 1
      end)
      print(string.format(
        "[WSG Reward Debug] End reward summary { instanceId: %s, participants: %s, rewarded: %s, skipped: %s }",
        tostring(instanceId), tostring(participantCount), tostring(rewarded), tostring(skipped)
      ))
    elseif mapIsArena then
      WsgState.forEachParticipants(wsgState, instanceId, function(player, participant)
        if WsgState.isDeserted(participant) then
          print(string.format(
            "[Reward] Badges rejected { match: ARENA, instanceId: %s, player: %s, guidLow: %s, reason: deserted, total: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            tostring(player:GetItemCount(ARENA_BADGE_ITEM_ID, true))
          ))
          return
        end

        local count = participant.team == winner and 2 or 1
        local badges, total, added = giveBadges(player, ARENA_BADGE_ITEM_ID, count)
        if badges > 0 then
          print(string.format(
            "[Reward] Badges granted { match: ARENA, instanceId: %s, player: %s, guidLow: %s, count: %s, total: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            tostring(badges), tostring(total)
          ))
        else
          print(string.format(
            "[Reward] Badges rejected { match: ARENA, instanceId: %s, player: %s, guidLow: %s, reason: %s, total: %s }",
            tostring(instanceId), player:GetName(), tostring(player:GetGUIDLow()),
            added and "badge_count_unchanged" or "add_item_failed", tostring(total)
          ))
        end
      end, function(participant)
        print(string.format(
          "[Reward] Badges rejected { match: ARENA, instanceId: %s, player: %s, guidLow: %s, reason: %s }",
          tostring(instanceId), tostring(participant.name), tostring(participant.guidLow),
          WsgState.isDeserted(participant) and "deserted" or "player_unavailable"
        ))
      end)
    end

    WsgState.clearMatch(wsgState, instanceId)
  end, 100, 1)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_WHO_REQUEST, function(event, requester, target)
  if not requester or not target then return end
  local accountId = target:GetAccountId()
  local targetName = target:GetName()
  AuthDBQueryAsync("SELECT da.discord_login, a.joindate, a.username FROM account a LEFT JOIN discord_account da ON a.id = da.discord_id OR a.id = da.account_id WHERE a.id = " .. tostring(accountId), function(result)
    if not result then
      return
    end
    local discordLogin = not result:IsNull(0) and result:GetString(0) or "None"
    local joinDate = not result:IsNull(1) and result:GetString(1) or ""
    local accountName = not result:IsNull(2) and result:GetString(2) or ""

    local infoMsg = "|cFFFFA500[Who Info]|r " .. targetName .. ": Discord: " .. discordLogin
    if joinDate ~= "" then
      infoMsg = infoMsg .. " | Joined: " .. joinDate:sub(1, 10)
    end
    if requester:IsGM() and accountName ~= "" then
      infoMsg = infoMsg .. " | Account: " .. accountName
    end

    requester:SendBroadcastMessage(infoMsg)
  end)
end)

-- Every 10 seconds in WSG:
-- 9 honor if within 40 yards of friendly flag carrier (or carrying own team's flag)
-- 6 honor if within 40 yards of enemy flag carrier (or carrying enemy flag)
-- 3 honor otherwise
CreateLuaEvent(function()
  WsgState.forEachActiveBattlegrounds(wsgState, function(instanceId, players)
    local player = players[1]
    local bg = player:GetBattleground()
    if not bg or bg:GetStatus() ~= STATUS_IN_PROGRESS then return end

    local map = player:GetMap()
    if not map then return end

    local flagCarriers = {}
    for _, p in ipairs(map:GetPlayers()) do
      local hasAllianceFlag = p:HasAura(WSG_ALLIANCE_FLAG_AURA)
      local hasHordeFlag = p:HasAura(WSG_HORDE_FLAG_AURA)
      if hasAllianceFlag or hasHordeFlag then
        table.insert(flagCarriers, {
          player = p,
          hasAllianceFlag = hasAllianceFlag,
          hasHordeFlag = hasHordeFlag,
        })
      end
    end

    for _, player in ipairs(players) do
      local honorAmount = 3
      local pTeam = player:GetBgTeamId()
      for _, carrier in ipairs(flagCarriers) do
        if player:GetDistance(carrier.player) <= 40.0 then
          local isFriendlyFC = (pTeam == 0 and carrier.hasHordeFlag)
            or (pTeam == 1 and carrier.hasAllianceFlag)
          if isFriendlyFC then
            honorAmount = 9
            break
          end
          honorAmount = math.max(honorAmount, 6)
        end
      end
      player:ModifyHonorPoints(honorAmount)
    end
  end)
end, 10000, 0)
