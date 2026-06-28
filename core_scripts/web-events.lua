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
  local account_id = player:GetAccountId()
  AuthDBQueryAsync(
    "SELECT discord_login FROM discord_account WHERE account_id="
    ..tostring(account_id), function (result)
    if not result then
    print("Account ID: "..account_id.." logged in !")
      return
    end
    local discord_login = result:GetString(0)
    print("Account ID: "..account_id.." aka "..discord_login.." logged in !")
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
  if channel == 1 then
    -- Send message to players of both factions in the channel
    SendWebEvent('GENERAL_CHANNEL_MESSAGE', player, {
      message = msg:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("^%s+", ""):gsub("%s+$", "")
    })
    local classColor = classColors[player:GetClass()] or "|cFFFFFFFF" 
    local team = player:GetTeam() == 1 and "Horde" or "Alliance"
    local name = player:GetName()
    local login = getDiscordName(player:GetAccountId()) or player:GetAccountName()
    SendWorldMessage("[|cFFFFA5001|r]"
      .."[|Hplayer:"..name.."|h|cFFFFA500"..login.."|r"
      .."|TInterface\\FriendsFrame\\PlusManz-"..team..":12|t"
      ..classColor..name.."|h|r]: "
      ..msg
    )
    return false -- Prevents the message from duplicating in the original chat
  end
  --]]
end)

AuthDBQuery([[
CREATE TABLE IF NOT EXISTS discord_message (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  discord_id  BIGINT UNSIGNED NOT NULL,
  message     VARCHAR(255) NOT NULL,
  FOREIGN KEY (discord_id) REFERENCES discord_account(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
]])

--function IsAlliance(race)
--  return race == 11 -- draenai
--      or race == 4 -- night elf
--      or race == 3 -- dwarf
--      or race == 1 -- human
--      or race == 7 -- gnome
--end

local query_check_new_messages = [[
SELECT id, discord_login, account_id, message
FROM discord_message
JOIN discord_account ON discord_message.discord_id = discord_account.discord_id
LIMIT 1
]]

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
  return "|cFFFFA500@"..login.."|r"
end

local handledMessages = {}
function DisplayNewMessages(result)
  if not result then return end
  local processId = math.random()
  repeat
    local message_id = result:GetUInt32(0)
    if handledMessages[message_id] == nil then
      local account_id = result:GetUInt32(2)
      local login = result:GetString(1)
      local msg = result:GetString(3)
      local player = GetActivePlayerForAccount(account_id)
      if player then
        local classColor = classColors[player:GetClass()] or "|cFFFFFFFF" 
        local team = player:GetTeam() == 1 and "Horde" or "Alliance"
        local name = player:GetName()
        msg = "[|Hplayer:"..name.."|h|cFFFFA500"..login.."|r"
        .."|TInterface\\FriendsFrame\\PlusManz-"..team..":12|t"
        ..classColor..name.."|h|r]: "..msg
      else
        msg = "[|cFFFFA500"..login.."|r]: "..msg
      end

      SendWorldMessage("[|cFFFFA5001|r]"..msg:gsub("<@(%d+):([^>]+)>", ReplaceDiscordMentions))
      AuthDBQuery("DELETE FROM discord_message WHERE id = "..tostring(message_id))
    end
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
