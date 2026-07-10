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
local queueDelayTime = 60
local annouceFreq = math.floor(queueDelayTime / 2) -- announce at half time
local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
local teamNames = { [0] = "alliance", [1] = "horde" }

-- Tracks real players who have been sent an invite popup but haven't entered yet.
-- Prevents UpdateWSGQueue from re-processing them every second while they decide.
-- NOTE: Lua-side guard; the C++ idempotency guard in InviteToBattleground is the
-- authoritative lock — this just stops orphan BGs from being created on duplicate procs.
local pendingInvites = {}

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

    -- 2. Balance the real players across the two teams
    -- All of the smaller team is added as-is
    local smallTeam = #playersByTeam[0] > #playersByTeam[1] and 1 or 0
    local largeTeam = smallTeam == 0 and 1 or 0
    for i, player in ipairs(playersByTeam[smallTeam]) do
        if player:InviteToBattleground(bg, smallTeam) then
            pendingInvites[player:GetGUIDLow()] = true
        end
        table.insert(balancedRealPlayers[smallTeam], player)
    end

    -- The first retainCount players from the bigger team stay on largeTeam (keeping balance at ±1)
    -- Excess players beyond that alternate between teams
    -- TODO: try to preserve groups, randomize the rest so overflow is not always the same players
    local retainCount = #playersByTeam[smallTeam] + 1
    for i, player in ipairs(playersByTeam[largeTeam]) do
        local teamId = largeTeam
        if i > retainCount then
            teamId = (i - retainCount) % 2 == 1 and smallTeam or largeTeam
        end
        if player:InviteToBattleground(bg, teamId) then
            pendingInvites[player:GetGUIDLow()] = true
        end
        table.insert(balancedRealPlayers[teamId], player)
    end

    local teamBotsNeeded = {
        [0] = minPlayersPerTeam - #balancedRealPlayers[0],
        [1] = minPlayersPerTeam - #balancedRealPlayers[1],
    }

    -- 3. Gather available online roster bots, grouped by native faction (0 = Alliance, 1 = Horde)
    ShuffleTable(fixedRoster)
    for _, botName in ipairs(fixedRoster) do
        local bot = GetPlayerByName(botName)
        if bot then
            -- Guard: never add a bot that is already in a battleground (prevents double-add crash)
            if not bot:InBattleground() then
                local team = bot:GetTeam()
                if teamBotsNeeded[team] > 0 then
                    bot:AddToBattleground(bg, team)
                    bot:SetBotStrategy("+bg", 1)
                    print("[WSG Queue] Adding bot " .. bot:GetName() .. " to " .. teamNames[team])
                    teamBotsNeeded[team] = teamBotsNeeded[team] - 1
                end
            end
        else
            print("[WSG Queue Debug] Bot " .. botName .. " is OFFLINE.")
        end
    end

    SendWorldMessage("[WSG Queue] Match is starting!")
end

CreateLuaEvent(function ()
    local queuedPlayers = GetPlayersInQueue(bgTypeId, bracketId)
    local realPlayersCount = 0
    local currentTime = GetCurrTime()
    local shouldProc = false
    local longestWait = 0
    local eligiblePlayers = {}

    for _, player in ipairs(queuedPlayers) do
        -- Skip players already sent an invite (Lua-side guard until C++ filter is compiled in)
        if not pendingInvites[player:GetGUIDLow()] then
            realPlayersCount = realPlayersCount + 1
            table.insert(eligiblePlayers, player)
            local joinTime = player:GetBattlegroundQueueJoinTime(bgTypeId)
            if joinTime > 0 then
                local waitTime = currentTime - joinTime
                if waitTime >= (queueDelayTime * 1000) then
                    shouldProc = true
                end
                if waitTime > longestWait then
                    longestWait = waitTime
                end
            end
        end
    end

    local waitSeconds = math.floor(longestWait / 1000)
    if realPlayersCount > 0 and waitSeconds > 0 and waitSeconds % annouceFreq == 0 then
        local timeLeft = 60 - waitSeconds
        if timeLeft > 0 then
            print("[WSG Queue] Queue active. " .. realPlayersCount .. " player(s) waiting. Time left to proc: " .. timeLeft .. "s")
            SendWorldMessage("[WSG Queue] " .. realPlayersCount .. " player(s) waiting in queue. Match starts in " .. timeLeft .. "s.")
        end
    end

    if shouldProc and realPlayersCount > 0 then
        ProcessAndStartMatch(eligiblePlayers, realPlayersCount)
    end
end, 1000, 0)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_ENTER, function(event, player)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    pendingInvites[player:GetGUIDLow()] = nil -- should not be needed but keep as safety
    print("[WSG Queue]" .. label .. " has successfully queued for Warsong Gulch.")
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_LEAVE, function(event, player)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    pendingInvites[player:GetGUIDLow()] = nil
    print("[WSG Queue] " .. label .. " has left the queue.")
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    pendingInvites[player:GetGUIDLow()] = nil
    print("[BG Match] " .. label .. " entered Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")")
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    local name = player:GetName()
    local botText = player:IsBot() and "Bot" or "Player"
    print("[BG Match] " .. botText .. " " .. name .. " left Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")")
    if not bg then return end
    local map = bg:GetMap()
    if not map then return end
    local players = map:GetPlayers()
    local realPlayers = 0
    local bots = {}
    for _, p in ipairs(players) do
        if p:GetName() ~= player:GetName() then
            if p:IsBot() then
                table.insert(bots, p)
            else
                realPlayers = realPlayers + 1
            end
        end
    end

    print("[BG Match] playersLeft: " .. realPlayers)
    if realPlayers > 0 then
        print("[WSG Queue] " .. realPlayers .. " real player(s) still remaining in BG.")
        return
    end

    print("[WSG Queue] No real players remaining in BG map " .. mapId .. " (Instance " .. instanceId .. "). Ending match and removing bots...")
    for _, p in ipairs(bots) do
        print("[WSG Queue] Kicking bot " .. p:GetName() .. " from battleground.")
        p:LeaveBattleground()
    end
    bg:EndBattleground(2) -- End with NEUTRAL to clean up the BG instance
    bg:SetEndTime(1)      -- Force immediate cleanup (1ms countdown)
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