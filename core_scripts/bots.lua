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
            print("[WSG Queue Debug] Found configured bot in DB -> " .. inspect({ bot = name }))
        until not query:NextRow()
    else
        print("[WSG Queue Debug] Warning: No configured bots found in database or query failed.")
    end
    print("[Fixed Roster] Loaded enabled bots -> " .. inspect({ count = #fixedRoster }))
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
local activeBGInstances = {}

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
    local assignments = WsgBalance.assign(WsgBalance.groupQueuedPlayers(queuedPlayers))

    local bg = CreateBattleground(bgTypeId, bracketId)
    if not bg then
        print("[WSG Queue] Error: Failed to create battleground instance")
        return
    end

    bg:StartBattleground()
    activeBGInstances[bg:GetInstanceId()] = bg

    print("[WSG Queue Debug] Match procced! Assignments:")
    for _, assignment in ipairs(assignments) do
        local player = assignment.player
        local teamId = assignment.team
        local teamName = teamNames[teamId] or tostring(teamId)
        local grp = player:GetGroup()
        local groupLabel = grp and ("Group#" .. tostring(grp:GetGUID())) or "Solo"

        print("[WSG Queue Debug] " .. player:GetName() .. " [" .. groupLabel .. "] -> " .. teamName)
        player:SendBroadcastMessage("[WSG Queue Debug] Assigned to " .. teamName .. " (" .. groupLabel .. ")")

        if player:InviteToBattleground(bg, teamId) then
            pendingInvites[player:GetGUIDLow()] = bg:GetInstanceId()
            table.insert(balancedRealPlayers[teamId], player)
        else
            local reason = "InviteToBattleground failed (already invited or not found in WSG queue)"
            print("[WSG Queue] Failed to invite -> " .. inspect({ player = player:GetName(), reason = reason }))
            pendingInvites[player:GetGUIDLow()] = nil -- Clear guard on failure so player can re-queue/re-try if needed
        end
    end

    print("[WSG Queue] Processed queued players -> " .. inspect({ realPlayersCount = realPlayersCount, allianceAssigned = #balancedRealPlayers[0], hordeAssigned = #balancedRealPlayers[1] }))

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
                    print("[WSG Queue] Adding bot -> " .. inspect({ bot = bot:GetName(), team = teamNames[team] }))
                    teamBotsNeeded[team] = teamBotsNeeded[team] - 1
                end
            end
        else
            print("[WSG Queue Debug] Bot offline -> " .. inspect({ bot = botName }))
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
            print("[WSG Queue] Queue active -> " .. inspect({ waitingPlayers = realPlayersCount, timeLeftSec = timeLeft }))
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
    pendingInvites[player:GetGUIDLow()] = nil -- should not be needed but keep as safety
    print("[WSG Queue] Player queued -> " .. inspect({ player = player:GetName(), isBot = player:IsBot() }))
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_LEAVE, function(event, player)
    if not player then return end
    local guidLow = player:GetGUIDLow()
    local invitedInstanceId = pendingInvites[guidLow]
    pendingInvites[guidLow] = nil

    print("[WSG Queue] Player left queue -> " .. inspect({ player = player:GetName(), isBot = player:IsBot() }))

    if invitedInstanceId and not player:IsBot() then
        print("[WSG Queue] Real player declined/expired invite -> " .. inspect({ player = player:GetName(), invitedInstanceId = invitedInstanceId }))

        local bg = GetBattleground(invitedInstanceId, bgTypeId)
        local map = (bg and bg:GetMap()) or GetMapById(489, invitedInstanceId)
        if map and bg then
            local isEmpty = CheckBGEmpty(player, 489, invitedInstanceId)
            if not isEmpty then
                BalanceBGBots(map, bg, "leave", player:GetName())
                SyncBGPlayerData(map)
            end
        end
    end
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

local function BalanceBGBots(map, bg, triggerEvent, playerName)
    if not map or not bg then return end

    local plan = WsgBalance.computeMapBotActions(map, minPlayersPerTeam)

    local removedBotNames = {}
    for _, bot in ipairs(plan.toRemove) do
        if bot then
            local botName = type(bot.GetName) == "function" and bot:GetName() or tostring(bot)
            table.insert(removedBotNames, botName)
            print("[Bot Balance] Removing bot from BG -> " .. inspect({ bot = botName }))
            if type(bot.LeaveBattleground) == "function" then
                bot:LeaveBattleground()
            end
        end
    end

    local addedInfo = {}
    for team, count in pairs(plan.toAdd) do
        if count > 0 then
            table.insert(addedInfo, count .. " " .. (teamNames[team] or tostring(team)))
            print("[Bot Balance] Adding bots to team -> " .. inspect({ count = count, team = teamNames[team] or team }))
            ShuffleTable(fixedRoster)
            for _, botName in ipairs(fixedRoster) do
                if count <= 0 then break end
                local bot = GetPlayerByName(botName)
                if bot and not bot:InBattleground() then
                    bot:AddToBattleground(bg, team)
                    bot:SetBotStrategy("+bg", 1)
                    print("[Bot Balance] Added bot to team -> " .. inspect({ bot = bot:GetName(), team = teamNames[team] or team }))
                    count = count - 1
                end
            end
        end
    end

    local msgs = {}
    if #removedBotNames > 0 then
        table.insert(msgs, "Kicking bot(s): " .. table.concat(removedBotNames, ", "))
    end
    if #addedInfo > 0 then
        table.insert(msgs, "Adding bot(s): " .. table.concat(addedInfo, ", "))
    end

    local prefix = "[WSG Bot Balance]"
    if playerName and triggerEvent then
        prefix = "[WSG Bot Balance] " .. triggerEvent .. " -> " .. inspect({ player = playerName })
    end

    local msgText
    if #msgs > 0 then
        msgText = prefix .. " " .. table.concat(msgs, " | ")
    else
        msgText = prefix .. " Roster balanced (No bot actions needed)."
    end

    print(msgText)
    SendWorldMessage(msgText)
end

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    if not player then return end
    local isBot = player:IsBot()
    local playerName = player:GetName()
    local playerGuidLow = player:GetGUIDLow()

    pendingInvites[playerGuidLow] = nil
    print("[DEBUG ON_ENTER_BG] Hook fired -> " .. inspect({ player = playerName, isBot = isBot, mapId = mapId, instanceId = instanceId }))

    if isBot then return end

    CreateLuaEvent(function()
        local bg = GetBattleground(instanceId, bgTypeId)
        local map = (bg and bg:GetMap()) or GetMapById(mapId or 489, instanceId)
        print("[DEBUG ON_ENTER_BG] Delayed check -> " .. inspect({ player = playerName, mapFound = (map ~= nil), bgFound = (bg ~= nil) }))
        if map and bg then
            BalanceBGBots(map, bg, "join", playerName)
            SyncBGPlayerData(map)
        end
    end, 1000, 1)
end)

local function GetBGInstance(instanceId)
    if instanceId and instanceId > 0 then
        return activeBGInstances[instanceId] or GetBattleground(instanceId, bgTypeId)
    end
    for instId, bgObj in pairs(activeBGInstances) do
        if bgObj then
            return bgObj
        end
    end
    return nil
end

local function CheckBGEmpty(player, mapId, instanceId)
    local instId = (instanceId and instanceId > 0) and instanceId or 0
    local bg = GetBGInstance(instId)
    local map = GetMapById(mapId or 489, instId)

    if not map then
        print("[BG Match] map not found -> " .. inspect({ instanceId = instId }))
        return false
    end

    local playerName = player and player:GetName() or ""
    for _, p in ipairs(map:GetPlayers()) do
        if p:GetName() ~= playerName and not p:IsBot() then
            print("[WSG Queue] Real player remaining in BG -> " .. inspect({ player = p:GetName(), instanceId = instId }))
            return false
        end
    end

    print("[WSG Queue] No real players remaining in BG -> " .. inspect({ mapId = mapId, instanceId = instId }))
    if bg then
        pcall(function()
            bg:EndBattleground(bgTypeId)
            bg:SetEndTime(1) -- 1ms cleanup countdown
        end)
    end
    if instId > 0 then
        activeBGInstances[instId] = nil
    end
    return true
end

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    local botText = (player and player:IsBot()) and "Bot" or "Player"
    local playerName = player and player:GetName() or "Unknown"

    local instId = (instanceId and instanceId > 0) and instanceId or 0
    local realBg = GetBGInstance(instId)
    local map = GetMapById((mapId and mapId > 0) and mapId or 489, instId)

    print("[DEBUG ON_LEAVE_BG] Hook fired -> " .. inspect({ type = botText, player = playerName, mapId = mapId or 489, instanceId = instId }))

    local isEmpty = CheckBGEmpty(player, mapId, instId)
    if isEmpty or (player and player:IsBot()) then return end

    print("[DEBUG ON_LEAVE_BG] Check -> " .. inspect({ player = playerName, mapFound = (map ~= nil), bgFound = (realBg ~= nil) }))
    if map and realBg then
        BalanceBGBots(map, realBg, "leave", playerName)
        SyncBGPlayerData(map)
    end
end)

-- Standard Eluna Map Change Fallback (Event 28: PLAYER_EVENT_ON_MAP_CHANGE)
RegisterPlayerEvent(28, function(event, player)
    if not player or player:IsBot() then return end
    local inBG = player:InBattleground()
    print("[DEBUG ON_MAP_CHANGE (Event 28)] Map change -> " .. inspect({ player = player:GetName(), mapId = player:GetMapId(), inBG = inBG }))

    if inBG then
        local bgId = player:GetBattlegroundId()
        local bgType = player:GetBattlegroundTypeId()
        local bg = (bgId and bgId > 0) and GetBattleground(bgId, (bgType and bgType > 0) and bgType or bgTypeId) or nil
        local map = GetMapById(player:GetMapId(), bgId)
        if bg and map then
            print("[DEBUG ON_MAP_CHANGE] Balancing bots..." .. inspect({ player = player:GetName(), bgId = bgId }))
            BalanceBGBots(map, bg, "join", player:GetName())
            SyncBGPlayerData(map)
        end
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
