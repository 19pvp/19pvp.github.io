local fixedRoster = {}

-- Load the fixed roster from the database
local function LoadFixedRoster()
    fixedRoster = {}
    local query = CharDBQuery("SELECT name FROM 19pvp_playerbots.playerbots_fixed_roster WHERE enabled = 1")
    if query then
        repeat
            local name = query:GetString(0)
            table.insert(fixedRoster, name)
        until not query:NextRow()
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

RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_JOIN_BG, function(event, player)
    local name = player:GetName()
    
    if player:IsBot() then
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

        for _, botName in ipairs(fixedRoster) do
            local bot = GetPlayerByName(botName)
            if bot then
                local isQueued = bot:InBattleGroundQueue()
                local status = isQueued and "Queued" or "Not Queued"
                local logLine = " - " .. botName .. " (Online) - " .. status
                print(logLine)
                SendWorldMessage(logLine)
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

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    local logMsg = "[BG Match] " .. botText .. " " .. name .. " entered Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")"
    print(logMsg)
    SendWorldMessage(logMsg)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    local logMsg = "[BG Match] " .. botText .. " " .. name .. " left Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")"
    print(logMsg)
    SendWorldMessage(logMsg)
end)

