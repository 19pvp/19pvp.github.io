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
        return player:InBattlegroundQueue()
    end
    return false
end

local PLAYER_EVENT_ON_PLAYER_JOIN_BG = 74
local queueTimerEventId = nil

local function ProcessAndStartMatch()
    queueTimerEventId = nil
    
    local bgTypeId = 2 -- Warsong Gulch
    local level = 19
    local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
    if not bracketId or bracketId == 0 then
        print("[WSG Queue] Error: Could not find bracket ID for level " .. level)
        SendWorldMessage("[WSG Queue] Error: Could not find bracket ID for level " .. level)
        return
    end

    -- 1. Get all players in the queue for this bracket and check if there are real players
    local queuedPlayers = GetPlayersInQueue(bgTypeId, bracketId)
    local playersByTeam = {
        [0] = {}, -- Alliance
        [1] = {}  -- Horde
    }

    local realPlayersCount = 0
    for _, player in ipairs(queuedPlayers) do
        if not player:IsBot() then
            realPlayersCount = realPlayersCount + 1
            local queuedTeam = player:GetBattlegroundQueueTeam(bgTypeId)
            -- Default to player's actual team if neutral/invalid
            if queuedTeam ~= 0 and queuedTeam ~= 1 then
                queuedTeam = player:GetTeam()
            end
            table.insert(playersByTeam[queuedTeam], player)
        end
    end

    -- If no real players queued, cancel silently without spamming world announcements
    if realPlayersCount == 0 then
        print("[WSG Queue] No real players in queue, cancelling match creation.")
        return
    end

    print("[WSG Queue] 60 seconds have passed. Reorganizing queue and starting balanced match...")
    SendWorldMessage("[WSG Queue] 60 seconds elapsed. Balancing teams and starting the match...")

    -- 2. Create a new Battleground instance
    local bg = CreateBattleground(bgTypeId, bracketId)
    if not bg then
        print("[WSG Queue] Error: Failed to create battleground instance")
        SendWorldMessage("[WSG Queue] Error: Failed to create battleground instance")
        return
    end

    print("[WSG Queue] Found " .. realPlayersCount .. " real players queued (Alliance: " .. #playersByTeam[0] .. ", Horde: " .. #playersByTeam[1] .. ")")

    -- 3. Balance the real players across the two teams
    -- To keep the teams as balanced as possible, we alternate placing all queued real players
    local allRealPlayers = {}
    for _, p in ipairs(playersByTeam[0]) do table.insert(allRealPlayers, p) end
    for _, p in ipairs(playersByTeam[1]) do table.insert(allRealPlayers, p) end

    local balancedRealPlayers = {
        [0] = {}, -- Alliance
        [1] = {}  -- Horde
    }

    for i, player in ipairs(allRealPlayers) do
        local teamId = (i % 2 == 1) and 0 or 1
        table.insert(balancedRealPlayers[teamId], player)
    end

    local allianceRealCount = #balancedRealPlayers[0]
    local hordeRealCount = #balancedRealPlayers[1]

    -- Target players per team is 10 for WSG (or GetMaxPlayersPerTeam())
    local maxPlayersPerTeam = bg:GetMaxPlayersPerTeam()
    local targetPlayersCount = maxPlayersPerTeam

    -- 4. Gather available online roster bots
    local availableBots = {}
    for _, botName in ipairs(fixedRoster) do
        local bot = GetPlayerByName(botName)
        if bot and not bot:InBattleground() and not bot:InBattlegroundQueue() then
            table.insert(availableBots, bot)
        end
    end

    -- 5. Calculate how many bots we need for each team to reach the target quota
    local allianceBotsNeeded = targetPlayersCount - allianceRealCount
    local hordeBotsNeeded = targetPlayersCount - hordeRealCount

    print("[WSG Queue] Balance Target per team: " .. targetPlayersCount)
    print("[WSG Queue] Alliance: " .. allianceRealCount .. " real players, " .. allianceBotsNeeded .. " bots needed")
    print("[WSG Queue] Horde: " .. hordeRealCount .. " real players, " .. hordeBotsNeeded .. " bots needed")

    -- Distribute bots to Alliance
    local allianceBots = {}
    for i = 1, allianceBotsNeeded do
        if #availableBots > 0 then
            local bot = table.remove(availableBots, 1)
            table.insert(allianceBots, bot)
        else
            break
        end
    end

    -- Distribute bots to Horde
    local hordeBots = {}
    for i = 1, hordeBotsNeeded do
        if #availableBots > 0 then
            local bot = table.remove(availableBots, 1)
            table.insert(hordeBots, bot)
        else
            break
        end
    end

    -- 6. Add real players to the BG instance
    for _, player in ipairs(balancedRealPlayers[0]) do
        print("[WSG Queue] Adding player " .. player:GetName() .. " to Alliance")
        player:AddToBattleground(bg, 0)
    end
    for _, player in ipairs(balancedRealPlayers[1]) do
        print("[WSG Queue] Adding player " .. player:GetName() .. " to Horde")
        player:AddToBattleground(bg, 1)
    end

    -- 7. Add bots to the BG instance
    for _, bot in ipairs(allianceBots) do
        print("[WSG Queue] Adding bot " .. bot:GetName() .. " to Alliance")
        bot:AddToBattleground(bg, 0)
        -- Enable BG strategy for the bot
        bot:SetBotStrategy("+bg", 1)
    end
    for _, bot in ipairs(hordeBots) do
        print("[WSG Queue] Adding bot " .. bot:GetName() .. " to Horde")
        bot:AddToBattleground(bg, 1)
        -- Enable BG strategy for the bot
        bot:SetBotStrategy("+bg", 1)
    end

    -- 8. Register and start the battleground preparation countdown
    bg:StartBattleground()
    SendWorldMessage("[WSG Queue] Match is starting! Teams balanced: Alliance (" .. (allianceRealCount + #allianceBots) .. ") vs Horde (" .. (hordeRealCount + #hordeBots) .. ")")
end

print("[WSG Queue Debug] Registering event handler for PLAYER_EVENT_ON_PLAYER_JOIN_BG (" .. PLAYER_EVENT_ON_PLAYER_JOIN_BG .. ")...")

RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_JOIN_BG, function(event, player)
    local name = player:GetName()
    local isBot = player:IsBot()
    print("[WSG Queue Debug] Event 74 (PLAYER_EVENT_ON_PLAYER_JOIN_BG) triggered for: " .. name .. " (IsBot: " .. tostring(isBot) .. ")")
    
    if isBot then
        -- Log to server console
        print("[WSG Queue] Bot " .. name .. " has successfully queued for Warsong Gulch.")
        SendWorldMessage("[WSG Queue] Bot " .. name .. " has successfully queued for Warsong Gulch.")
    else
        print("[WSG Queue] Player " .. name .. " has queued for Warsong Gulch.")
        SendWorldMessage("[WSG Queue] Player " .. name .. " has queued for Warsong Gulch.")
        
        if not queueTimerEventId then
            print("[WSG Queue] Starting 60-second timer before balancing and starting match...")
            SendWorldMessage("[WSG Queue] Waiting 60 seconds for real players to join before starting match...")
            queueTimerEventId = CreateLuaEvent(ProcessAndStartMatch, 60000, 1)
        else
            print("[WSG Queue] Timer already running, waiting for it to finish.")
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

    -- If a real player is leaving, check if there are any real players left in this BG instance
    if not player:IsBot() then
        local bg = GetBattleground(instanceId, mapId)
        if bg then
            local map = bg:GetMap()
            if map then
                local players = map:GetPlayers()
                local realPlayersCount = 0
                for _, p in ipairs(players) do
                    -- Count all other real players still in the battleground
                    if p:GetName() ~= name and not p:IsBot() then
                        realPlayersCount = realPlayersCount + 1
                    end
                end

                if realPlayersCount == 0 then
                    print("[WSG Queue] No real players remaining in BG map " .. mapId .. " (Instance " .. instanceId .. "). Ending match and removing bots...")
                    SendWorldMessage("[WSG Queue] No real players remaining. Closing battleground match.")
                    
                    -- Kick all remaining bots out of the battleground
                    for _, p in ipairs(players) do
                        if p:IsBot() then
                            print("[WSG Queue] Kicking bot " .. p:GetName() .. " from battleground.")
                            p:LeaveBattleground()
                        end
                    end

                    bg:EndBattleground(2) -- End with NEUTRAL to clean up the BG instance
                else
                    print("[WSG Queue] " .. realPlayersCount .. " real player(s) still remaining in BG.")
                end
            end
        end
    end
end)
