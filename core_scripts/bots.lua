print("[WSG Queue Debug] Loading bots.lua script...")

local WsgBalance = require("wsg_balance")

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
local queueDelayTime = 10
local annouceFreq = math.floor(queueDelayTime / 2) -- announce at half time
local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
local teamNames = { [0] = "alliance", [1] = "horde" }

-- Tracks real players who have been sent an invite popup but haven't entered yet.
-- Prevents UpdateWSGQueue from re-processing them every second while they decide.
-- NOTE: Lua-side guard; the C++ idempotency guard in InviteToBattleground is the
-- authoritative lock — this just stops orphan BGs from being created on duplicate procs.
local pendingInvites = {}

local function GroupQueuedPlayers(queuedPlayers)
    local groupsByKey = {}
    local groups = {}

    for _, player in ipairs(queuedPlayers) do
        local group = player:GetGroup()
        local key = group and "group:" .. tostring(group:GetGUID()) or "solo:" .. player:GetGUIDLow()
        if not groupsByKey[key] then
            groupsByKey[key] = { players = {} }
            groups[#groups + 1] = groupsByKey[key]
        end
        groupsByKey[key].players[#groupsByKey[key].players + 1] = {
            player = player,
            nativeTeam = player:GetTeam(),
        }
    end

    return groups
end

local function ProcessAndStartMatch(queuedPlayers, realPlayersCount)
    local balancedRealPlayers = { [0] = {}, [1] = {} }
    local assignments = WsgBalance.assign(GroupQueuedPlayers(queuedPlayers))

    local bg = CreateBattleground(bgTypeId, bracketId)
    if not bg then
        print("[WSG Queue] Error: Failed to create battleground instance")
        return
    end

    bg:StartBattleground()

    SendWorldMessage("[WSG Queue Debug] Match procced! Assignments:")
    for _, assignment in ipairs(assignments) do
        local player = assignment.player
        local teamId = assignment.team
        local teamName = teamNames[teamId] or tostring(teamId)
        local grp = player:GetGroup()
        local groupLabel = grp and ("Group#" .. tostring(grp:GetGUID())) or "Solo"

        SendWorldMessage("[WSG Queue Debug] " .. player:GetName() .. " [" .. groupLabel .. "] -> " .. teamName)
        player:SendBroadcastMessage("[WSG Queue Debug] Assigned to " .. teamName .. " (" .. groupLabel .. ")")

        if player:InviteToBattleground(bg, teamId) then
            table.insert(balancedRealPlayers[teamId], player)
        else
            local reason = "InviteToBattleground failed (already invited or not found in WSG queue)"
            print("[WSG Queue] Failed to invite " .. player:GetName() .. ": " .. reason)
            SendWorldMessage("[WSG Queue Debug] Failed to invite " .. player:GetName() .. ": " .. reason)
            pendingInvites[player:GetGUIDLow()] = nil -- Clear guard on failure so player can re-queue/re-try if needed
        end
    end

    print("[WSG Queue] Found " .. realPlayersCount .. " real players queued; assigned Alliance: " .. #balancedRealPlayers[0] .. ", Horde: " .. #balancedRealPlayers[1])

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
        local timeLeft = queueDelayTime - waitSeconds
        if timeLeft > 0 then
            print("[WSG Queue] Queue active. " .. realPlayersCount .. " player(s) waiting. Time left to proc: " .. timeLeft .. "s")
            SendWorldMessage("[WSG Queue] " .. realPlayersCount .. " player(s) waiting in queue. Match starts in " .. timeLeft .. "s.")
        end
    end

    if shouldProc and realPlayersCount > 0 then
        for _, p in ipairs(eligiblePlayers) do
            pendingInvites[p:GetGUIDLow()] = true
        end
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

local function SyncBGPlayerData(map)
    if not map then return end
    local bots = {}
    local hordePlayers = {}
    local alliancePlayers = {}
    local realPlayers = {}
    for _, p in ipairs(map:GetPlayers()) do
        local name = p:GetName()
        if p:IsBot() then
            table.insert(bots, name)
        else
            table.insert(realPlayers, p)
        end
        -- GetBgTeamId returns 0 for Alliance, 1 for Horde
        if p:GetBgTeamId() == 1 then
            table.insert(hordePlayers, name)
        else
            table.insert(alliancePlayers, name)
        end
    end
    local payload = table.concat(bots, ",") .. ";" .. table.concat(hordePlayers, ",") .. ";" .. table.concat(alliancePlayers, ",")
    for _, p in ipairs(realPlayers) do
        -- Channel 7 is CHAT_MSG_WHISPER (addon message whisper)
        p:SendAddonMessage("CFBG_SYNC", payload, 7, p)
    end
end

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local label = (player:IsBot() and " bot " or " player ") .. player:GetName()
    pendingInvites[player:GetGUIDLow()] = nil
    print("[BG Match] " .. label .. " entered Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")")
    
    local map = player:GetMap()
    if map then
        -- Delay slightly to ensure player is fully in map and lists are ready
        CreateLuaEvent(function()
            SyncBGPlayerData(map)
        end, 1000, 1)
    end
end)

local function CheckBGEmpty(player, mapId, instanceId)
    local bg = GetBattleground(instanceId, 2) -- Warsong Gulch (2)
    if not bg then
        print("[BG Match] bg not found, can't cleanup")
        return
    end
    local map = bg:GetMap()
    if not map then
        print("[BG Match] map not found, can't cleanup")
        return
    end

    for _, p in ipairs(map:GetPlayers()) do
        if p:GetName() ~= player:GetName() and not p:IsBot() then
            print("[WSG Queue] " .. p:GetName() .. " still remaining in BG, keeping it open.")
            return
        end
    end

    -- No real players left: end the BG.
    -- BattlegroundMap::Update removes all remaining players (bots) once the timer expires.
    -- Guard: EndBattleground checks STATUS_IN_PROGRESS internally and is a no-op if already ended.
    print("[WSG Queue] No real players remaining in BG map " .. mapId .. " (Instance " .. instanceId .. "). Ending match.")
    bg:EndBattleground(2)
    bg:SetEndTime(1) -- 1ms cleanup countdown
end

--  looks like RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg) does not recieve the bg, it's nil.
-- I don't know how we pass it but it's wrong
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId)
    local botText = player:IsBot() and "Bot" or "Player"
    print("[BG Match] " .. botText .. " " .. player:GetName() .. " left Battleground Map " .. mapId .. " (Instance " .. instanceId .. ")")
    CheckBGEmpty(player, mapId, instanceId)
    
    local map = GetMapById(mapId, instanceId)
    if map then
        SyncBGPlayerData(map)
    end
end)

RegisterServerEvent(30, function(event, sender, type, prefix, msg, target)
    if prefix == "CFBG_SYNC" then
        local map = sender:GetMap()
        if map then
            SyncBGPlayerData(map)
        end
        return false -- Suppress message forwarding
    end
end)

-- 1) We must never allow more than 1 players on each teams
-- then in order whe must try to:
-- 2) keep the groups intact
-- 3) preserve players teams, horde should stay horde and alliance should stay ally
-- 4) balance based on skill level once I have this rating defined and tracked successfully
-- the skill balance is the least important, preserving groups is most important, only split groups
-- if we would have more players in one side otherwhise

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
