print("[WSG Queue Debug] Loading bots.lua script...")

local WsgBalance = require("wsg_balance")

local fixedRoster = {}
local query = CharDBQuery("SELECT name FROM 19pvp_playerbots.playerbots_fixed_roster WHERE enabled = 1")
if query then
    repeat
        local name = query:GetString(0)
        table.insert(fixedRoster, name)
    until not query:NextRow()
end
print("[Fixed Roster] Loaded enabled bots " .. inspect(fixedRoster))

local startupBotSpecs = custom_data and custom_data.wsg_bot_specs or {}

local function ReplaceWarriorWeapon(bot)
    if not bot or bot:GetClass() ~= 1 then return end

    local oldCount = bot:GetItemCount(1459)
    if oldCount > 0 then bot:RemoveItem(1459, oldCount) end

    local weapon = bot:GetItemByEntry(1482)
    if not weapon then weapon = bot:AddItem(1482, 1) end
    if weapon then weapon:SetEnchantment(1900, 0, 0) end
end

local function InitializeBot(bot)
    if not bot or not bot:IsBot() then return end
    ReplaceWarriorWeapon(bot)
    local spec = startupBotSpecs[bot:GetClass()]
    if not spec then return end
    bot:Command("talents apply " .. spec.talents)
    if spec.glyphs and #spec.glyphs > 0 then
        bot:Command("glyph equip " .. table.concat(spec.glyphs, " "))
    end
    print("[Bot Specs] Applied startup spec " .. inspect({ bot = bot:GetName(), talents = spec.talents, glyphs = spec.glyphs }))
end

for _, botName in ipairs(fixedRoster) do
    InitializeBot(GetPlayerByName(botName))
end

local bgTypeId = 2 -- Warsong Gulch
local level = 19
local minPlayersPerTeam = 5
local queueDelayTime = 10
local annouceFreq = math.floor(queueDelayTime / 2)
local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
local teamNames = { [0] = "alliance", [1] = "horde" }
local pendingInvites = {}
local activeBGInstances = {}

local botRegistry = { [0] = {}, [1] = {} }

local function AddBotToRegistry(bot)
    if not bot or not bot:IsBot() then return end
    local team = bot:GetTeam()
    if botRegistry[team] then botRegistry[team][bot:GetClass()] = bot:GetName() end
end

for _, botName in ipairs(fixedRoster) do
    AddBotToRegistry(GetPlayerByName(botName))
end

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGIN, function(event, player)
    InitializeBot(player)
    AddBotToRegistry(player)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGOUT, function(event, player)
    if player and botRegistry[player:GetTeam()] then
        botRegistry[player:GetTeam()][player:GetClass()] = nil
    end
end)

local function GetAvailableBotByClass(team, classId)
    local botName = botRegistry[team] and botRegistry[team][classId]
    if not botName then return nil end
    local bot = GetPlayerByName(botName)
    if not bot or bot:InBattleground() then return nil end
    return bot
end

CreateLuaEvent(function ()
    local queuedPlayers = GetPlayersInQueue(bgTypeId, bracketId)
    local realPlayersCount = 0
    local currentTime = GetCurrTime()
    local shouldProc = false
    local longestWait = 0
    local eligiblePlayers = {}

    for _, player in ipairs(queuedPlayers) do
        if not pendingInvites[player:GetGUIDLow()] then
            realPlayersCount = realPlayersCount + 1
            table.insert(eligiblePlayers, player)
            local joinTime = player:GetBattlegroundQueueJoinTime(bgTypeId)
            if joinTime > 0 then
                local waitTime = currentTime - joinTime
                if waitTime >= (queueDelayTime * 1000) then shouldProc = true end
                if waitTime > longestWait then longestWait = waitTime end
            end
        end
    end

    local waitSeconds = math.floor(longestWait / 1000)
    if realPlayersCount > 0 and waitSeconds > 0 and waitSeconds % annouceFreq == 0 then
        local timeLeft = queueDelayTime - waitSeconds
        if timeLeft > 0 then
            print("[WSG Queue] Queue active " .. inspect({ waitingPlayers = realPlayersCount, timeLeftSec = timeLeft }))
            SendWorldMessage("[WSG Queue] " .. realPlayersCount .. " player(s) waiting in queue. Match starts in " .. timeLeft .. "s.")
        end
    end

    if shouldProc and realPlayersCount > 0 then
        for _, p in ipairs(eligiblePlayers) do pendingInvites[p:GetGUIDLow()] = true end

        local balancedRealPlayers = { [0] = {}, [1] = {} }
        local assignments = WsgBalance.assign(WsgBalance.groupQueuedPlayers(eligiblePlayers))
        local bg = CreateBattleground(bgTypeId, bracketId)
        if bg then
            bg:StartBattleground()
            activeBGInstances[bg:GetInstanceId()] = bg

            print("[WSG Queue Debug] Match procced! Assignments:")
            for _, assignment in ipairs(assignments) do
                local player = assignment.player
                local teamId = assignment.team
                local teamName = teamNames[teamId] or tostring(teamId)
                local grp = player:GetGroup()
                local groupLabel = grp and ("Group#" .. tostring(grp:GetGUID())) or "Solo"

                print("[WSG Queue Debug] " .. player:GetName() .. " [" .. groupLabel .. "] " .. teamName)
                player:SendBroadcastMessage("[WSG Queue Debug] Assigned to " .. teamName .. " (" .. groupLabel .. ")")

                if player:InviteToBattleground(bg, teamId) then
                    pendingInvites[player:GetGUIDLow()] = bg:GetInstanceId()
                    table.insert(balancedRealPlayers[teamId], player)
                else
                    print("[WSG Queue] Failed to invite " .. inspect({ player = player:GetName() }))
                    pendingInvites[player:GetGUIDLow()] = nil
                end
            end

            print("[WSG Queue] Processed queued players " .. inspect({ realPlayersCount = realPlayersCount, allianceAssigned = #balancedRealPlayers[0], hordeAssigned = #balancedRealPlayers[1] }))

            for team = 0, 1 do
                local needed = minPlayersPerTeam - #balancedRealPlayers[team]
                if needed > 0 then
                    local classIds = WsgBalance.selectClassesToAdd(balancedRealPlayers[team], needed)
                    for _, classId in ipairs(classIds) do
                        local bot = GetAvailableBotByClass(team, classId)
                        if bot then
                            bot:AddToBattleground(bg, team)
                            bot:SetBotStrategy("+bg", 1)
                            print("[WSG Queue] Adding bot " .. inspect({ bot = bot:GetName(), class = classId, team = teamNames[team] }))
                        end
                    end
                end
            end
            SendWorldMessage("[WSG Queue] Match is starting!")
        end
    end
end, 1000, 0)

local function CheckBGEmpty(player, mapId, instanceId)
    local instId = (instanceId and instanceId > 0) and instanceId or 0
    local bg = instId > 0 and GetBattleground(instId, bgTypeId) or nil
    if not bg then return false end
    activeBGInstances[instId] = bg

    local departingName = player and player:GetName() or ""
    local map = GetMapById(mapId or 489, instId)
    if map then
        for _, p in ipairs(map:GetPlayers()) do
            if p:GetName() ~= departingName and not p:IsBot() then
                print("[WSG Queue] Real player remaining in BG map " .. inspect({ player = p:GetName(), instanceId = instId }))
                return false
            end
        end
    end

    for guidLow, invInstId in pairs(pendingInvites) do
        if invInstId == instId then
            pendingInvites[guidLow] = nil
            for _, p in ipairs(GetPlayersInWorld()) do
                if p:GetGUIDLow() == guidLow then
                    print("[WSG Queue] Retracting BG invite " .. inspect({ player = p:GetName(), instanceId = instId }))
                    p:LeaveBattleground()
                end
            end
        end
    end

    print("[WSG Queue] No real players remaining in BG map. Retracting invites and closing BG " .. inspect({ mapId = mapId, instanceId = instId }))

    pcall(function()
        bg:EndBattleground(bgTypeId)
        bg:SetEndTime(1)
    end)

    if instId > 0 then activeBGInstances[instId] = nil end
    return true
end

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_ENTER, function(event, player)
    if not player or player:IsBot() then return end
    local guidLow = player:GetGUIDLow()
    pendingInvites[guidLow] = nil
    print("[WSG Queue] Player queued " .. inspect({ player = player:GetName(), isBot = false }))

    -- Check if there is an active running BG instance to immediately invite into
    for instanceId, _ in pairs(activeBGInstances) do
        local bg = GetBattleground(instanceId, bgTypeId)
        if bg then
            activeBGInstances[instanceId] = bg
            local map = GetMapById(489, instanceId) or bg:GetMap()
            if map then
                local roster = WsgBalance.extractRoster(map)
                if roster then
                    local group = player:GetGroup()
                    local queueGroup = {}
                    if group then
                        for _, member in ipairs(group:GetMembers()) do
                            if member and not member:IsBot() and not pendingInvites[member:GetGUIDLow()] and not member:InBattleground() then
                                table.insert(queueGroup, member)
                            end
                        end
                    else
                        table.insert(queueGroup, player)
                    end

                    if #queueGroup > 0 then
                        local allianceCount = #roster[0].players
                        local hordeCount = #roster[1].players
                        local grouped = WsgBalance.groupQueuedPlayers(queueGroup)
                        local assignments = WsgBalance.assign(grouped, allianceCount, hordeCount)

                        for _, assignment in ipairs(assignments) do
                            local p = assignment.player
                            local teamId = assignment.team
                            local pGuid = p:GetGUIDLow()
                            print("[WSG Queue] Inviting late-queueing player/group member to existing BG " .. inspect({ player = p:GetName(), instanceId = instanceId, targetTeam = teamId }))
                            if p:InviteToBattleground(bg, teamId) then
                                pendingInvites[pGuid] = instanceId
                            end
                        end
                        break
                    end
                end
            end
        else
            activeBGInstances[instanceId] = nil
        end
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_LEAVE, function(event, player)
    if not player then return end
    local guidLow = player:GetGUIDLow()
    local invitedInstanceId = pendingInvites[guidLow]
    pendingInvites[guidLow] = nil

    print("[WSG Queue] Player left queue " .. inspect({ player = player:GetName(), isBot = player:IsBot() }))

    if invitedInstanceId and not player:IsBot() then
        print("[WSG Queue] Real player declined/expired invite " .. inspect({ player = player:GetName(), invitedInstanceId = invitedInstanceId }))
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
    local bots, hordePlayers, alliancePlayers, realPlayers = {}, {}, {}, {}
    for _, p in ipairs(map:GetPlayers()) do
        local name = p:GetName()
        if p:IsBot() then table.insert(bots, name) else table.insert(realPlayers, p) end
        if p:GetBgTeamId() == 1 then table.insert(hordePlayers, name) else table.insert(alliancePlayers, name) end
    end
    local payload = table.concat(bots, ",") .. ";" .. table.concat(hordePlayers, ",") .. ";" .. table.concat(alliancePlayers, ",")
    for _, p in ipairs(realPlayers) do p:SendAddonMessage("CFBG_SYNC", payload, 7, p) end
end

local function BalanceBGBots(map, bg, triggerEvent, playerName)
    if not map or not bg then return end

    local instId = (type(bg.GetInstanceId) == "function") and bg:GetInstanceId() or 0
    if instId > 0 then
        local freshBg = GetBattleground(instId, bgTypeId)
        if freshBg then
            bg = freshBg
            activeBGInstances[instId] = freshBg
        end
    end

    local plan = WsgBalance.computeMapBotActions(map, minPlayersPerTeam)

    local removedBotNames = {}
    for _, bot in ipairs(plan.toRemove) do
        if bot then
            local botName = type(bot.GetName) == "function" and bot:GetName() or tostring(bot)
            table.insert(removedBotNames, botName)
            print("[Bot Balance] Removing bot from BG " .. inspect({ bot = botName }))
            if type(bot.LeaveBattleground) == "function" then
                bot:LeaveBattleground()
            end
        end
    end

    local addedInfo = {}
    for team, classIds in pairs(plan.toAdd) do
        if #classIds > 0 then
            table.insert(addedInfo, #classIds .. " " .. (teamNames[team] or tostring(team)))
            print("[Bot Balance] Adding bots to team " .. inspect({ count = #classIds, team = teamNames[team] or team, classes = classIds }))

            for _, classId in ipairs(classIds) do
                local bot = GetAvailableBotByClass(team, classId)
                if bot then
                    bot:AddToBattleground(bg, team)
                    bot:SetBotStrategy("+bg", 1)
                    print("[Bot Balance] Added bot to team " .. inspect({ bot = bot:GetName(), class = classId, team = teamNames[team] or team }))
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
        prefix = "[WSG Bot Balance] " .. triggerEvent .. " " .. inspect({ player = playerName })
    end

    local msgText
    if #msgs > 0 then
        msgText = prefix .. " " .. table.concat(msgs, " | ")
        print(msgText)
        SendWorldMessage(msgText)
    end
end

-- Periodic BG Balance Check (every 5 seconds)
CreateLuaEvent(function()
    for instanceId, _ in pairs(activeBGInstances) do
        local bg = GetBattleground(instanceId, bgTypeId)
        if bg then
            activeBGInstances[instanceId] = bg
            local map = GetMapById(489, instanceId) or bg:GetMap()
            if map then
                local hasRealPlayers = false
                for _, p in ipairs(map:GetPlayers()) do
                    if not p:IsBot() then
                        hasRealPlayers = true
                        break
                    end
                end

                if hasRealPlayers then
                    BalanceBGBots(map, bg, "periodic_check")
                    SyncBGPlayerData(map)
                end
            end
        else
            activeBGInstances[instanceId] = nil
        end
    end
end, 5000, 0)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    if not player then return end
    local isBot = player:IsBot()
    local playerName = player:GetName()
    local playerGuidLow = player:GetGUIDLow()

    pendingInvites[playerGuidLow] = nil
    print("[DEBUG ON_ENTER_BG] Hook fired " .. inspect({ player = playerName, isBot = isBot, mapId = mapId, instanceId = instanceId }))

    if isBot then return end

    CreateLuaEvent(function()
        local bg = GetBattleground(instanceId, bgTypeId)
        local map = (bg and bg:GetMap()) or GetMapById(mapId or 489, instanceId)
        print("[DEBUG ON_ENTER_BG] Delayed check " .. inspect({ player = playerName, mapFound = (map ~= nil), bgFound = (bg ~= nil) }))
        if map and bg then
            BalanceBGBots(map, bg, "join", playerName)
            SyncBGPlayerData(map)
        end
    end, 1000, 1)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    local botText = (player and player:IsBot()) and "Bot" or "Player"
    local playerName = player and player:GetName() or "Unknown"

    local instId = (instanceId and instanceId > 0) and instanceId or 0
    local realBg = instId > 0 and GetBattleground(instId, bgTypeId) or nil
    local map = GetMapById((mapId and mapId > 0) and mapId or 489, instId)

    print("[DEBUG ON_LEAVE_BG] Hook fired " .. inspect({ type = botText, player = playerName, mapId = mapId or 489, instanceId = instId }))

    local isEmpty = CheckBGEmpty(player, mapId, instId)
    if isEmpty or (player and player:IsBot()) then return end

    print("[DEBUG ON_LEAVE_BG] Check " .. inspect({ player = playerName, mapFound = (map ~= nil), bgFound = (realBg ~= nil) }))
    if map and realBg then
        BalanceBGBots(map, realBg, "leave", playerName)
        SyncBGPlayerData(map)
    end
end)

-- Standard Eluna Map Change Fallback (Event 28: PLAYER_EVENT_ON_MAP_CHANGE)
RegisterPlayerEvent(PLAYER_EVENT_ON_MAP_CHANGE, function(event, player)
    if not player or player:IsBot() then return end
    local inBG = player:InBattleground()
    print("[DEBUG ON_MAP_CHANGE (Event 28)] Map change " .. inspect({ player = player:GetName(), mapId = player:GetMapId(), inBG = inBG }))

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

-- Doors Open Hook (BG_EVENT_ON_START = 1)
RegisterBGEvent(BG_EVENT_ON_START, function(event, bg, bgTypeIdVal, instanceId)
    if not bg then return end
    local instId = instanceId or bg:GetInstanceId()
    local map = GetMapById(489, instId)

    local hasRealPlayers = false
    if map then
        for _, p in ipairs(map:GetPlayers()) do
            if not p:IsBot() then
                hasRealPlayers = true
                break
            end
        end
    end

    if not hasRealPlayers then
        print("[WSG Queue] Doors opened for BG, but 0 real players are inside. Retracting invites and closing BG " .. inspect({ instanceId = instId }))

        -- Retract any remaining pending invites
        for guidLow, invInstId in pairs(pendingInvites) do
            if invInstId == instId then
                pendingInvites[guidLow] = nil
                for _, p in ipairs(GetPlayersInWorld()) do
                    if p:GetGUIDLow() == guidLow then
                        p:LeaveBattleground()
                    end
                end
            end
        end

        pcall(function()
            bg:EndBattleground(bgTypeIdVal or bgTypeId)
            bg:SetEndTime(1)
        end)
        activeBGInstances[instId] = nil
    end
end)

RegisterServerEvent(ADDON_EVENT_ON_MESSAGE, function(event, sender, type, prefix, msg, target)
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
