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

local bgTypeId = 2 -- Warsong Gulch
local level = 19
local minPlayersPerTeam = 5
local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
local teamNames = { [0] = "alliance", [1] = "horde" }
local function ProcessAndStartMatch(queuedPlayers, realPlayersCount)
    ShuffleTable(queuedPlayers)
    local playersByTeam = { [0] = {}, [1] = {} }
    local balancedRealPlayers = { [0] = {}, [1] = {} }
    for _, player in ipairs(queuedPlayers) do
        table.insert(playersByTeam[player:GetTeam()], player)
    end

    local bg = CreateBattleground(bgTypeId, bracketId)
    if not bg then
        print("[WSG Queue] Error: Failed to create battleground instance")
        return
    end

    bg:StartBattleground()

    print("[WSG Queue] Found " .. realPlayersCount .. " real players queued (Alliance: " .. #playersByTeam[0] .. ", Horde: " .. #playersByTeam[1] .. ")")

    -- All of the smaller team is added as-is
    local smallTeam = #playersByTeam[0] > #playersByTeam[1] and 1 or 0
    local largeTeam = smallTeam == 0 and 1 or 0
    for i, player in ipairs(playersByTeam[smallTeam]) do
        player:InviteToBattleground(bg, smallTeam)
        table.insert(balancedRealPlayers[smallTeam], player)
    end

    -- The first retainCount players from the bigger team stay on largeTeam (keeping balance at ±1)
    -- Excess players beyond that alternate between teams
    -- TODO: try to preserve groups, randomize the rest so overflow is not always the same players
    local retainCount = #playersByTeam[smallTeam] + 1
    for i, player in ipairs(playersByTeam[largeTeam]) do
        local teamId = largeTeam
        if i > retainCount then
            teamId = (i - retainCount) % 2 == 1 and largeTeam or smallTeam
        end
        player:InviteToBattleground(bg, teamId)
        table.insert(balancedRealPlayers[teamId], player)
    end

    local teamBotsNeeded = {
        [0] = minPlayersPerTeam - #balancedRealPlayers[0],
        [1] = minPlayersPerTeam - #balancedRealPlayers[1],
    }

    -- 4. Gather available online roster bots, grouped by native faction (0 = Alliance, 1 = Horde)
    -- TODO: try to give bots that would help with missing classes, balancing the roster
    -- we should never have bots in 2 different games once a game team gets more than 5 participants bots should leave
    ShuffleTable(fixedRoster)
    for _, botName in ipairs(fixedRoster) do
        local bot = GetPlayerByName(botName)
        if bot then
            local team = bot:GetTeam()
            if teamBotsNeeded[team] > 0 then
                bot:AddToBattleground(bg, team)
                bot:SetBotStrategy("+bg", 1)
                print("[WSG Queue] Adding bot " .. bot:GetName() .. " to ".. teamNames[team])
                teamBotsNeeded[team] = teamBotsNeeded[team] - 1
            end
        else
            print("[WSG Queue Debug] Bot " .. botName .. " is OFFLINE.")
        end
    end

    SendWorldMessage("[WSG Queue] Match is starting!")
end

local function UpdateWSGQueue()
    local queuedPlayers = GetPlayersInQueue(bgTypeId, bracketId)
    local realPlayersCount = 0
    local currentTime = GetCurrTime()
    local shouldProc = false
    local longestWait = 0
    for _, player in ipairs(queuedPlayers) do
        realPlayersCount = realPlayersCount + 1
        local joinTime = player:GetBattlegroundQueueJoinTime(bgTypeId)
        if joinTime > 0 then
            local waitTime = currentTime - joinTime
            if waitTime >= 60000 then
                shouldProc = true
            end
            if waitTime > longestWait then
                longestWait = waitTime
            end
        end
    end

    local waitSeconds = math.floor(longestWait / 1000)
    if realPlayersCount > 0 and waitSeconds > 0 and waitSeconds % 30 == 0 then
        local timeLeft = 60 - waitSeconds
        if timeLeft > 0 then
            print("[WSG Queue] Queue active. " .. realPlayersCount .. " player(s) waiting. Time left to proc: " .. timeLeft .. "s")
            SendWorldMessage("[WSG Queue] " .. realPlayersCount .. " player(s) waiting in queue. Match starts in " .. timeLeft .. "s.")
        end
    end

    if shouldProc and realPlayersCount > 0 then
        ProcessAndStartMatch(queuedPlayers, realPlayersCount)
    end
end

CreateLuaEvent(UpdateWSGQueue, 1000, 0)

RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_JOIN_BG, function(event, player)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    -- Check if a BG with available slots exist
    -- If not, do nothing, let the UpdateWSGQueue polling do the thing
    print("[WSG Queue]".. label .. " has successfully queued for Warsong Gulch.")
end)

-- Event IDs for entering and leaving BG matches
RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_LEAVE_BG_QUEUE, function(event, player)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    print("[WSG Queue] " .. label .. " has left the queue.")
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    print("[BG Match] " .. label .. " entered Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")")
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    local logMsg = "[BG Match] " .. botText .. " " .. name .. " left Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")"
    print(logMsg)

    -- If a real player is leaving, check if there are any real players left in this BG instance
    if player:IsBot() then return end
    local bg = GetBattleground(instanceId, mapId)
    print("[BG Match] bg found")
    if not bg then return end
    local map = bg:GetMap()
    print("[BG Match] map found")
    if not map then return end
    local players = map:GetPlayers()
    local playersLeft = 0
    for _, p in ipairs(players) do
        -- Count all other real players still in the battleground
        if p:GetName() ~= name and not p:IsBot() then
            playersLeft = playersLeft + 1
        end
    end
    print("[BG Match] playersLeft: " .. playersLeft)

    if playersLeft == 0 then
        print("[WSG Queue] No real players remaining in BG map " .. mapId .. " (Instance " .. instanceId .. "). Ending match and removing bots...")

        -- Kick all remaining bots out of the battleground
        for _, p in ipairs(players) do
            if p:IsBot() then
                print("[WSG Queue] Kicking bot " .. p:GetName() .. " from battleground.")
                p:LeaveBattleground()
            end
        end

        bg:EndBattleground(2) -- End with NEUTRAL to clean up the BG instance
        bg:SetEndTime(1)      -- Force immediate cleanup (1ms countdown)
    else
        print("[WSG Queue] " .. playersLeft .. " real player(s) still remaining in BG.")
    end
end)
-- 
-- // Prompt them one by one
-- I need to handle when a new player queue but a wsg is already in progress
-- 
-- - If the bg as a side with more players, join the oposite side, always balance
-- - if possible we should try to alternate the side with more players: if previously horde side had 3 players alliance had 2, then then
-- next 2 players will go alliance side, then the next 2 horde side, then the next 2 alliance side etc until full.
-- - We always add a bot in the under playered side
-- - if bg is full because of a bot we kick the bot to make room but this should only happen if the bg is 9 vs 10 then a bot will fill
-- the last slot to balance and we will need to kick him.
-- - a bot should always leave when a player enter.
-- - sometimes a new bot enter to counter balance