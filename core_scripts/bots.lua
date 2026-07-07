print("[WSG Queue Debug] Loading bots.lua script...")

local fixedRoster = {}

-- Load the fixed roster from the database
local function LoadFixedRoster()
    fixedRoster = {}
    local query = CharDBQuery("SELECT name FROM 19pvp_playerbots.playerbots_fixed_roster WHERE enabled = 1")
    if query then
        repeat
            local name = query:GetString(0)
            table.insert(fixedRoster, name)
            print("[WSG Queue Debug] Found configured bot in DB: " .. name)
        until not query:NextRow()
    else
        print("[WSG Queue Debug] Warning: No configured bots found in database or query failed.")
    end
    print("[Fixed Roster] Loaded " .. #fixedRoster .. " enabled bots from database.")
end

-- Initial load at server startup
LoadFixedRoster()

-- Expose public helper functions for other scripts or commands
function IsRosterBotOnline(name)
    local player = GetPlayerByName(name)
    return player ~= nil
end

function IsRosterBotQueued(name)
    local player = GetPlayerByName(name)
    if player then
        return player:InBattleGroundQueue()
    end
    return false
end

-- Event ID for Player Joining BG
local PLAYER_EVENT_ON_PLAYER_JOIN_BG = 74

print("[WSG Queue Debug] Registering event handler for PLAYER_EVENT_ON_PLAYER_JOIN_BG (" .. PLAYER_EVENT_ON_PLAYER_JOIN_BG .. ")...")

RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_JOIN_BG, function(event, player)
    local name = player:GetName()
    local isBot = player:IsBot()
    print("[WSG Queue Debug] Event 74 (PLAYER_EVENT_ON_PLAYER_JOIN_BG) triggered for: " .. name .. " (IsBot: " .. tostring(isBot) .. ")")
    
    if isBot then
        -- Log to server console
        print("[WSG Queue] Bot " .. name .. " has successfully queued for Warsong Gulch.")
        -- Log in-game
        SendWorldMessage("[WSG Queue] Bot " .. name .. " has successfully queued for Warsong Gulch.")
    else
        -- Log to server console
        print("[WSG Queue] Player " .. name .. " has queued for Warsong Gulch. Logging available bots:")
        -- Log in-game
        SendWorldMessage("[WSG Queue] Player " .. name .. " has queued for Warsong Gulch.")
        SendWorldMessage("[WSG Queue] Current Fixed Roster Queue Status:")
        -- wierd
        for _, botName in ipairs(fixedRoster) do
            local bot = GetPlayerByName(botName)
            if bot then
                local isQueued = bot:InBattlegroundQueue()
                if not isQueued then
                    local success = bot:JoinBattlegroundQueue(2, false)
                    local status = success and "Successfully Queued" or "Failed to Queue"
                    local logLine = " - " .. botName .. " (Online) - " .. status
                    print(logLine)
                    SendWorldMessage(logLine)
                else
                    local logLine = " - " .. botName .. " (Online) - Already Queued"
                    print(logLine)
                    SendWorldMessage(logLine)
                end
            else
                local logLine = " - " .. botName .. " (Offline)"
                print(logLine)
                SendWorldMessage(logLine)
            end
        end
    end
end)

-- Event IDs for entering and leaving BG matches
local PLAYER_EVENT_ON_ENTER_BG = 75
local PLAYER_EVENT_ON_LEAVE_BG = 76

print("[WSG Queue Debug] Registering event handler for PLAYER_EVENT_ON_ENTER_BG (" .. PLAYER_EVENT_ON_ENTER_BG .. ")...")
RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    print("[WSG Queue Debug] Event 75 (PLAYER_EVENT_ON_ENTER_BG) triggered for: " .. name .. " on map: " .. mapId)
    local logMsg = "[BG Match] " .. botText .. " " .. name .. " entered Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")"
    print(logMsg)
    SendWorldMessage(logMsg)
end)

print("[WSG Queue Debug] Registering event handler for PLAYER_EVENT_ON_LEAVE_BG (" .. PLAYER_EVENT_ON_LEAVE_BG .. ")...")
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    print("[WSG Queue Debug] Event 76 (PLAYER_EVENT_ON_LEAVE_BG) triggered for: " .. name .. " on map: " .. mapId)
    local logMsg = "[BG Match] " .. botText .. " " .. name .. " left Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")"
    print(logMsg)
    SendWorldMessage(logMsg)
end)

