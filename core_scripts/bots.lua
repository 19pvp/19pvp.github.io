require("custom-data")

local WsgBalance = require("wsg_balance")
local WsgState = require("wsg-state")

local fixedRoster = {}
local fixedRosterByClass = { [0] = {}, [1] = {} }
for _, botInfo in ipairs(custom_data.wsg_bot_roster) do
    fixedRoster[botInfo.name] = botInfo
    fixedRosterByClass[botInfo.team][botInfo.classId] = botInfo
end

local startupBotSpecs = custom_data and custom_data.wsg_bot_specs or {}

local WARRIOR_WEAPON_ITEM_ID = 1482
local WARRIOR_SHIELD_ITEM_ID = 3761

local function EnsureEquipped(bot, itemId, slot)
    local equipped = bot:GetEquippedItemBySlot(slot)
    if equipped and equipped:GetEntry() == itemId then return end

    local item = bot:GetItemByEntry(itemId)
    if not item then item = bot:AddItem(itemId, 1) end
    if item then bot:EquipItem(item, slot) end
end

local function ReplaceWarriorEquipment(bot)
    if not bot or bot:GetClass() ~= 1 then return end

    for _, itemId in ipairs({ 1459, 4818 }) do
        local oldCount = bot:GetItemCount(itemId)
        if oldCount > 0 then bot:RemoveItem(itemId, oldCount) end
    end

    local weapon = bot:GetItemByEntry(WARRIOR_WEAPON_ITEM_ID)
    if not weapon then weapon = bot:AddItem(WARRIOR_WEAPON_ITEM_ID, 1) end
    if weapon then weapon:SetEnchantment(1900, 0, 0) end

    for _, itemId in ipairs({ WARRIOR_SHIELD_ITEM_ID, 18706, 13966, 14530 }) do
        if not bot:GetItemByEntry(itemId) then bot:AddItem(itemId, 1) end
    end

    EnsureEquipped(bot, WARRIOR_WEAPON_ITEM_ID, SLOT_MAINHAND)
    EnsureEquipped(bot, WARRIOR_SHIELD_ITEM_ID, SLOT_OFFHAND)

    local shield = bot:GetEquippedItemBySlot(SLOT_OFFHAND)
    if shield and shield:GetEntry() == WARRIOR_SHIELD_ITEM_ID then
        shield:SetEnchantment(929, 0, 0)
    end

    for _, trinket in ipairs({
        { itemId = 18706, slot = SLOT_TRINKET1 },
        { itemId = 13966, slot = SLOT_TRINKET2 },
    }) do
        EnsureEquipped(bot, trinket.itemId, trinket.slot)
    end

    if not bot:HasSpell(55500) then bot:LearnSpell(55500) end
end

local function InitializeBot(bot)
    if not bot or not bot:IsBot() then return end
    ReplaceWarriorEquipment(bot)
    local spec = startupBotSpecs[bot:GetClass()]
    if not spec then return end
    bot:Command("talents apply " .. spec.talents)
    if spec.glyphs and #spec.glyphs > 0 then
        bot:Command("glyph equip " .. table.concat(spec.glyphs, " "))
    end
end

for _, botInfo in pairs(fixedRoster) do
    InitializeBot(GetPlayerByName(botInfo.name))
end

local bgTypeId = 2 -- Warsong Gulch
local WSG_MAP_ID = 489
local level = 19
local minPlayersPerTeam = 5
local queueDelayTime = 120
local annouceFreq = math.floor(queueDelayTime / 2)
local activeBGQueueDelayMs = 5000
local maxWsgPlayersPerTeam = 10
-- NOTE: This server uses a one-minute WSG preparation timer.
local BOT_PREP_DURATION_MS = 60000
local BOT_FILL_LEAD_MS = 5000
local bracketId = GetBattlegroundBracketIdByLevel(bgTypeId, level)
local teamNames = { [0] = "alliance", [1] = "horde" }
local wsgController = WsgBalance.createQueueController(WsgState.shared)
local PVP19_SERVER_ID = "19PVP"
local PVP19_ADDON_VERSION = "1.1"
local ProcessActiveBGQueuePlayer
local botFillAt = {}

local function getDebugPlayerValue(player, methodName)
    if not player or type(player[methodName]) ~= "function" then return nil end
    local ok, value = pcall(player[methodName], player)
    return ok and value or nil
end

local function formatDebugPlayer(player, overrides)
    overrides = overrides or {}
    return {
        guidLow = overrides.guidLow ~= nil and overrides.guidLow or getDebugPlayerValue(player, "GetGUIDLow"),
        name = overrides.name ~= nil and overrides.name or getDebugPlayerValue(player, "GetName"),
        class = overrides.class ~= nil and overrides.class or getDebugPlayerValue(player, "GetClass"),
        bgTeam = overrides.bgTeam ~= nil and overrides.bgTeam or getDebugPlayerValue(player, "GetBgTeamId"),
        race = overrides.race ~= nil and overrides.race or getDebugPlayerValue(player, "GetRace"),
    }
end

local function getDebugPlayerByGUID(guid)
    if type(GetPlayerByGUID) ~= "function" then return nil end
    local ok, player = pcall(GetPlayerByGUID, guid)
    return ok and player or nil
end

local function getDebugMapPlayers(instanceId)
    local map = GetMapById(WSG_MAP_ID, instanceId)
    if not map or type(map.GetPlayers) ~= "function" then return {} end

    local players = {}
    for _, player in ipairs(map:GetPlayers() or {}) do
        table.insert(players, formatDebugPlayer(player))
    end
    return players
end

local function getDebugActiveBGs()
    local active = {}
    for instanceId, bg in pairs(WsgState.shared.activeBGInstances) do
        local summary = {}
        local hasObject = type(bg) == "table" or type(bg) == "userdata"
        if hasObject and type(bg.GetStatus) == "function" then summary.status = bg:GetStatus() end
        if hasObject and type(bg.GetMapId) == "function" then summary.mapId = bg:GetMapId() end
        summary.players = getDebugMapPlayers(instanceId)
        active[instanceId] = summary
    end
    return active
end

local function getDebugParticipants()
    local participants = {}
    for instanceId, instanceParticipants in pairs(WsgState.shared.participants) do
        participants[instanceId] = {}
        for guidLow, participant in pairs(instanceParticipants) do
            local livePlayer = getDebugPlayerByGUID(participant.guid)
            participants[instanceId][guidLow] = formatDebugPlayer(livePlayer, {
                guidLow = participant.guidLow,
                name = participant.name,
                bgTeam = participant.team,
            })
        end
    end
    return participants
end

local function getDebugPendingInvites()
    local invites = {}
    for guidLow, invite in pairs(WsgState.shared.pendingInvites) do
        local livePlayer = getDebugPlayerByGUID(invite.guidLow)
        invites[guidLow] = formatDebugPlayer(livePlayer, {
            guidLow = invite.guidLow,
            class = invite.classId,
            bgTeam = invite.teamId,
        })
    end
    return invites
end

local function getDebugQueuePlayers()
    local players = {}
    for _, player in ipairs(GetPlayersInQueue(bgTypeId, bracketId) or {}) do
        table.insert(players, formatDebugPlayer(player))
    end
    return players
end

local function getDebugFixedRoster()
    local roster = {}
    for name, botInfo in pairs(fixedRoster) do
        roster[name] = {
            name = botInfo.name,
            class = botInfo.classId,
            bgTeam = botInfo.team,
            pending = botInfo.pending,
        }
    end
    return roster
end

local function sendWsgDebug(player)
    local snapshot = {
        state = {
            pendingInvites = getDebugPendingInvites(),
            activeBGInstances = getDebugActiveBGs(),
            departedPlayers = WsgState.shared.departedPlayers,
            participants = getDebugParticipants(),
            endRewardsDistributed = WsgState.shared.endRewardsDistributed,
            activeQueueRetryAt = WsgState.shared.activeQueueRetryAt,
            classCapWarnings = WsgState.shared.classCapWarnings,
            groupSplitWarnings = WsgState.shared.groupSplitWarnings,
            queueMidpointAlertSent = WsgState.shared.queueMidpointAlertSent,
            queueProjectionDirty = WsgState.shared.queueProjectionDirty,
        },
        queuedPlayers = getDebugQueuePlayers(),
        botFillAt = botFillAt,
        fixedRoster = getDebugFixedRoster(),
    }

    local text = inspect(snapshot)
    local chunkSize = 180
    local chunkCount = math.max(1, math.ceil(#text / chunkSize))
    player:SendAddonMessage("PVP19_DEBUG", "BEGIN:" .. tostring(chunkCount), 7, player)
    for chunkIndex = 1, chunkCount do
        local startIndex = (chunkIndex - 1) * chunkSize + 1
        player:SendAddonMessage(
            "PVP19_DEBUG",
            "DATA:" .. tostring(chunkIndex) .. ":" .. text:sub(startIndex, startIndex + chunkSize - 1),
            7,
            player
        )
    end
    player:SendAddonMessage("PVP19_DEBUG", "END", 7, player)
end

local function isJoinableBattleground(bg)
    if not bg then return false end
    local status = bg:GetStatus()
    return status > STATUS_WAIT_QUEUE and status < STATUS_WAIT_LEAVE
end

local classNames = {
    [1] = "Warrior",
    [2] = "Paladin",
    [3] = "Hunter",
    [4] = "Rogue",
    [5] = "Priest",
    [6] = "Death Knight",
    [7] = "Shaman",
    [8] = "Mage",
    [9] = "Warlock",
    [11] = "Druid",
}

local function getQueueJoinTime(player)
    local joinTime = player:GetBattlegroundQueueJoinTime(bgTypeId)
    return joinTime > 0 and joinTime or math.huge
end

local function sortQueuedPlayers(players)
    table.sort(players, function(left, right)
        local leftTime = getQueueJoinTime(left)
        local rightTime = getQueueJoinTime(right)
        if leftTime ~= rightTime then return leftTime < rightTime end
        return left:GetGUIDLow() < right:GetGUIDLow()
    end)
    return players
end

local function getMapTeamCounts(map, excludedGuids)
    local teamCounts = { [0] = 0, [1] = 0 }
    for _, player in ipairs(map:GetPlayers()) do
        local guidLow = player:GetGUIDLow()
        if not excludedGuids[guidLow] then
            local teamId = player:GetBgTeamId()
            if teamId == 0 or teamId == 1 then teamCounts[teamId] = teamCounts[teamId] + 1 end
        end
    end
    return teamCounts
end

local function warnClassCapPlayers(players)
    for _, player in ipairs(players or {}) do
        local guidLow = player:GetGUIDLow()
        if not wsgController:hasClassCapWarning(guidLow) then
            wsgController:markClassCapWarning(guidLow)
            player:SendBroadcastMessage("[WSG Queue] Your class has reached its limit for this match. Earlier queued players have priority; you will remain queued for the next available WSG.")
        end
    end
end

local function formatClassCounts(classCounts)
    local classIds = {}
    for classId, count in pairs(classCounts or {}) do
        if count > 0 then table.insert(classIds, classId) end
    end
    table.sort(classIds)

    local values = {}
    for _, classId in ipairs(classIds) do
        table.insert(values, (classNames[classId] or ("Class " .. tostring(classId))) .. " x" .. tostring(classCounts[classId]))
    end
    return #values > 0 and table.concat(values, ", ") or "none"
end

local function warnSplitGroups(splitGroups)
    for _, group in ipairs(splitGroups or {}) do
        for _, queuedPlayer in ipairs(group.players) do
            local player = queuedPlayer.player
            local guidLow = player:GetGUIDLow()
            if not wsgController:hasGroupSplitWarning(guidLow) then
                wsgController:markGroupSplitWarning(guidLow)
                player:SendBroadcastMessage("[WSG Queue] Your group is currently expected to be split between teams to keep WSG balanced. More players queueing may allow your group to stay together.")
            end
        end
    end
end

local function sendQueueMidpointStatus(selectedPlayers, excludedPlayers, decision, summary)
    local totalPlayers = summary.teamCounts[0] + summary.teamCounts[1]
    local slotsRemaining = math.max(0, (maxWsgPlayersPerTeam * 2) - totalPlayers)
    local message = string.format(
        "[WSG Queue] Midpoint update: projected teams are %d Alliance vs %d Horde; still slots for %d player(s). Classes — Alliance: %s. Horde: %s.",
        summary.teamCounts[0],
        summary.teamCounts[1],
        slotsRemaining,
        formatClassCounts(summary.classCounts[0]),
        formatClassCounts(summary.classCounts[1])
    )
    if #excludedPlayers > 0 then
        message = message .. " " .. tostring(#excludedPlayers) .. " player(s) are waiting for the next class-available slot."
    end
    SendWorldMessage(message)
end

local function isWsgQueuePlayer(player)
    for _, queuedPlayer in ipairs(GetPlayersInQueue(bgTypeId, bracketId)) do
        if queuedPlayer:GetGUIDLow() == player:GetGUIDLow() then return true end
    end
    return false
end

-- The native queue manager can also distribute players to an active WSG. Keep
-- that path on the same controller, otherwise it bypasses class/team planning.
local function planNativeBattlegroundQueueDistribution(bg, queueBracketId)
    if type(bg) ~= "table" and type(bg) ~= "userdata" then return {} end
    if type(bg.GetMapId) ~= "function" or type(bg.GetStatus) ~= "function"
        or type(bg.GetInstanceId) ~= "function" then
        return {}
    end

    if bg:GetMapId() ~= WSG_MAP_ID or queueBracketId ~= bracketId then return nil end
    if bg:GetStatus() >= STATUS_WAIT_LEAVE then return {} end

    local instanceId = bg:GetInstanceId()
    if type(instanceId) ~= "number" or instanceId <= 0 or instanceId ~= math.floor(instanceId) then
        return {}
    end

    local map = GetMapById(WSG_MAP_ID, instanceId)
    if not map or type(map.GetPlayers) ~= "function" then return {} end

    local departedPlayers = wsgController:getDepartedPlayers(instanceId)
    local roster = WsgBalance.extractRoster(map, departedPlayers)
    if not roster or not roster[0] or not roster[1]
        or type(roster[0].realCount) ~= "number" or type(roster[1].realCount) ~= "number" then
        return {}
    end

    local queuedPlayers = {}
    for _, player in ipairs(GetPlayersInQueue(bgTypeId, bracketId)) do
        if player and type(player.IsBot) == "function" and type(player.InBattleground) == "function"
            and type(player.GetGUID) == "function" and type(player.GetGUIDLow) == "function"
            and not player:IsBot()
            and not wsgController:getPendingInvite(player:GetGUIDLow())
            and not player:InBattleground() then
            table.insert(queuedPlayers, player)
        end
    end
    sortQueuedPlayers(queuedPlayers)

    local plan, excludedPlayers = wsgController:planActiveInvites(
        queuedPlayers,
        roster,
        instanceId,
        getMapTeamCounts(map, departedPlayers),
        maxWsgPlayersPerTeam
    )
    if type(plan) ~= "table" or type(plan.selectedPlayers) ~= "table" or type(plan.assignments) ~= "table"
        or #plan.selectedPlayers == 0 or #plan.assignments ~= #plan.selectedPlayers or not plan.fits then
        return {}
    end

    local distribution = {}
    local distributionPlayers = {}
    for _, assignment in ipairs(plan.assignments) do
        if type(assignment) ~= "table" or (type(assignment.player) ~= "table" and type(assignment.player) ~= "userdata")
            or type(assignment.player.GetGUID) ~= "function"
            or type(assignment.player.GetGUIDLow) ~= "function" then
            return {}
        end

        local player = assignment.player
        local teamId = WsgBalance.nativeDistributionTeamId(assignment.team)
        if not teamId then
            return {}
        end

        local guidOk, guid = pcall(player.GetGUID, player)
        if not guidOk then
            return {}
        end
        local guidKey = WsgBalance.nativeDistributionGuidKey(guid)
        if not guidKey then
            return {}
        end
        if distribution[guidKey] ~= nil then
            return {}
        end
        distribution[guidKey] = teamId
        table.insert(distributionPlayers, { player = player, teamId = teamId })
    end

    for _, assigned in ipairs(distributionPlayers) do
        wsgController:recordAcceptedInvite(assigned.player, instanceId, assigned.teamId)
    end

    return distribution
end

-- ALE already protects the Lua call with lua_pcall. Keep a second fail-closed
-- boundary here so a controller regression cannot fall through to native's
-- default team assignment or expose a malformed table to the C++ parser.
function OnBattlegroundQueueDistribution(bg, queueBracketId)
    local ok, result = xpcall(function()
        return planNativeBattlegroundQueueDistribution(bg, queueBracketId)
    end, function(err)
        return tostring(err)
    end)
    if not ok then
        return {}
    end
    return result
end

local restoredInstances = {}
for instanceId in pairs(WsgState.restoreFromWorld(WsgState.shared, bgTypeId, WSG_MAP_ID)) do
    local bg = GetBattleground(instanceId, bgTypeId)
    if isJoinableBattleground(bg) and not wsgController:getActiveBGInstances()[instanceId] then
        wsgController:trackActiveBG(bg)
        table.insert(restoredInstances, instanceId)
    end
end
if #restoredInstances > 0 then
end

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGIN, function(event, player)
    InitializeBot(player)

    local info = player and fixedRoster[player:GetName()]
    if info and info.pending then
        info.pending.lastAttemptAt = 0
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LOGOUT, function(event, player)
    local info = player and fixedRoster[player:GetName()]
    local pending = info and info.pending
    if not pending then return end

    if pending.state == "rejoining" then
        pending.state = "joining"
        pending.lastAttemptAt = 0
    else
        info.pending = nil
    end
end)

local function GetAvailableBotByClass(team, classId)
    local botInfo = fixedRosterByClass[team] and fixedRosterByClass[team][classId]
    if not botInfo then return nil, nil, { reason = "no_roster_entry" } end
    if botInfo.pending then
        return nil, botInfo, { reason = "pending", pendingState = botInfo.pending.state }
    end
    local bot = GetPlayerByName(botInfo.name)
    if bot and bot:InBattleground() then
        return nil, botInfo, { reason = "already_in_battleground" }
    end
    if not bot then return nil, botInfo, { reason = "offline" } end
    if not bot:IsInWorld() then return nil, botInfo, { reason = "not_in_world" } end
    return bot, botInfo, nil
end

local function LogoutFixedRosterBotAfterWsg(botName)
    local info = fixedRoster[botName]
    if not info then return end
    info.pending = {
        state = "leaving",
        lastAttemptAt = 0,
    }
end

local addDiagnosticAt = {}
local removeDiagnosticAt = {}

local function GetBotName(bot)
    if type(bot) == "table" and bot.name then return bot.name end
    if (type(bot) == "table" or type(bot) == "userdata") and type(bot.GetName) == "function" then
        return bot:GetName()
    end
    return tostring(bot)
end

local function GetBotState(bot, instanceId)
    local botName = GetBotName(bot)
    local currentBot = nil
    if (type(bot) == "table" or type(bot) == "userdata") and type(bot.GetName) == "function" then
        currentBot = bot
    elseif botName and type(GetPlayerByName) == "function" then
        currentBot = GetPlayerByName(botName)
    end

    local info = fixedRoster[botName]
    local pending = info and info.pending
    local state = {
        bot = botName,
        instanceId = instanceId,
        pendingState = pending and pending.state,
        pendingTeam = pending and pending.teamId,
        inWorld = currentBot and currentBot:IsInWorld() or false,
        inBattleground = currentBot and currentBot:InBattleground() or false,
        currentBgId = currentBot and currentBot:GetBattlegroundId() or nil,
        currentTeam = currentBot and currentBot:GetBgTeamId() or nil,
        flagCarrier = false,
    }
    if currentBot and type(currentBot.HasAura) == "function" then
        state.flagCarrier = currentBot:HasAura(WSG_HORDE_FLAG_AURA) or currentBot:HasAura(WSG_ALLIANCE_FLAG_AURA)
    end
    return state
end

local function LogBotAddBlocked(bg, team, classId, botInfo, diagnostic)
    local instanceId = bg and bg:GetInstanceId() or 0
    local botName = botInfo and botInfo.name or "unknown"
    local state = GetBotState(botName, instanceId)
    local reason = diagnostic and diagnostic.reason or "unavailable"
    local key = table.concat({
        tostring(instanceId), tostring(team), tostring(classId), botName, reason,
        tostring(state.pendingState), tostring(state.currentBgId), tostring(state.currentTeam),
    }, ":")
    local now = GetCurrTime()
    if addDiagnosticAt[key] and now - addDiagnosticAt[key] < 5000 then return end
    addDiagnosticAt[key] = now
    state.requestedTeam = team
    state.requestedClass = classId
    state.reason = reason
    if diagnostic then
        for field, value in pairs(diagnostic) do state[field] = value end
    end
end

local function LogBotRemovalBlocked(bot, instanceId, reason)
    local state = GetBotState(bot, instanceId)
    local key = table.concat({
        tostring(instanceId), tostring(state.bot), tostring(reason),
        tostring(state.pendingState), tostring(state.currentBgId), tostring(state.currentTeam),
    }, ":")
    local now = GetCurrTime()
    if removeDiagnosticAt[key] and now - removeDiagnosticAt[key] < 5000 then return end
    removeDiagnosticAt[key] = now
    state.reason = reason
end

local function AddBotToBattleground(bot, bg, teamId)
    if not bot or not isJoinableBattleground(bg) then return false end

    local instanceId = bg:GetInstanceId()
    if not bot:AddToBattleground(bg, teamId) then
        local botName = bot:GetName()
        local currentBgId = type(bot.GetBattlegroundId) == "function" and bot:GetBattlegroundId() or nil
        local currentTeam = type(bot.GetBgTeamId) == "function" and bot:GetBgTeamId() or nil

        local botInfo = fixedRoster[botName]
        if botInfo then
            botInfo.pending = {
                state = "rejoining",
                instanceId = instanceId,
                teamId = teamId,
                lastAttemptAt = 0,
            }
        end
        return false
    end

    local botName = bot:GetName()
    local botInfo = fixedRoster[botName]
    if botInfo then
        -- Reserve immediately: AddToBattleground succeeds before the bot is
        -- visible in the map snapshot, so another balance event can otherwise
        -- request the same bot repeatedly during that gap.
        botInfo.pending = {
            state = "entering",
            instanceId = instanceId,
            teamId = teamId,
            lastAttemptAt = 0,
        }
    end

    CreateLuaEvent(function()
        local currentBg = GetBattleground(instanceId, bgTypeId)
        if not isJoinableBattleground(currentBg) then
            if botInfo and botInfo.pending and botInfo.pending.instanceId == instanceId then
                botInfo.pending = nil
            end
            return
        end

        local currentBot = GetPlayerByName(botName)
        if not currentBot then return end

        local joined = currentBot:IsInWorld() and currentBot:InBattleground() and currentBot:GetBattlegroundId() == instanceId
        if joined then
            if botInfo and botInfo.pending and botInfo.pending.instanceId == instanceId then
                botInfo.pending = nil
            end
            currentBot:SetBotStrategy("+bg", 1)
            return
        end

        local info = fixedRoster[botName]
        if not info then return end
        info.pending = {
            state = "rejoining",
            instanceId = instanceId,
            teamId = teamId,
            lastAttemptAt = 0,
        }
    end, 3000, 1)
    return true
end

local function AddBotForClass(bg, team, classId)
    if not bg then
        return
    end
    if not isJoinableBattleground(bg) then
        LogBotAddBlocked(bg, team, classId, nil, { reason = "battleground_not_joinable", status = bg:GetStatus() })
        return
    end

    local bot, botInfo, diagnostic = GetAvailableBotByClass(team, classId)
    if bot then
        if AddBotToBattleground(bot, bg, team) then
        end
        return
    end

    LogBotAddBlocked(bg, team, classId, botInfo, diagnostic)
    if not botInfo or not bg then return end

    local instanceId = bg:GetInstanceId()
    if botInfo.pending then return end
    if diagnostic and diagnostic.reason == "already_in_battleground" then return end

    botInfo.pending = {
        state = "joining",
        instanceId = instanceId,
        teamId = team,
        lastAttemptAt = 0,
    }

end

local function IsBotFillWindowOpen(bg)
    if not bg then return false end
    if bg:GetStatus() ~= STATUS_WAIT_JOIN then return true end
    local fillAt = botFillAt[bg:GetInstanceId()]
    return fillAt and GetCurrTime() >= fillAt or false
end

local function ScheduleInitialBotFill(bg, classIdsByTeam, startedAt)
    if not bg then return end
    local instanceId = bg:GetInstanceId()
    local fillAt = startedAt + BOT_PREP_DURATION_MS - BOT_FILL_LEAD_MS
    botFillAt[instanceId] = fillAt
    local delay = math.max(0, fillAt - GetCurrTime())
    CreateLuaEvent(function()
        botFillAt[instanceId] = nil
        local currentBg = GetBattleground(instanceId, bgTypeId)
        if not isJoinableBattleground(currentBg) then return end

        for team = 0, 1 do
            for _, classId in ipairs(classIdsByTeam[team] or {}) do
                AddBotForClass(currentBg, team, classId)
            end
        end
    end, delay, 1)
end

local function GetPendingBotsForInstance(instanceId)
    local pendingBots = {}
    for _, botInfo in pairs(fixedRoster) do
        local pending = botInfo.pending
        if pending and (pending.state == "entering" or pending.state == "joining" or pending.state == "rejoining")
            and pending.instanceId == instanceId then
            table.insert(pendingBots, {
                name = botInfo.name,
                classId = botInfo.classId,
                teamId = pending.teamId,
            })
        end
    end
    return pendingBots
end

local function CancelPendingBot(bot, instanceId)
    if not bot or not bot.pending or not bot.name then return false end
    local botInfo = fixedRoster[bot.name]
    if not botInfo or not botInfo.pending or botInfo.pending.instanceId ~= instanceId then return false end

    botInfo.pending = nil
    return true
end

CreateLuaEvent(function()
    for botName, info in pairs(fixedRoster) do
        local pending = info.pending
        if pending then
            local now = GetCurrTime()
            if pending.state == "joining" then
                local bg = GetBattleground(pending.instanceId, bgTypeId)
                if not isJoinableBattleground(bg) then
                    info.pending = nil
                else
                    local bot = GetPlayerByName(botName)
                    if bot and bot:IsInWorld() then
                        local teamId = pending.teamId
                        info.pending = nil
                        if AddBotToBattleground(bot, bg, teamId) then
                        end
                    elseif not bot and now - pending.lastAttemptAt >= 5000 then
                        local accepted = LoginFixedRosterBot(botName)
                        pending.lastAttemptAt = now
                    end
                end
            elseif pending.state == "leaving" or pending.state == "rejoining" then
                local bot = GetPlayerByName(botName)
                if not bot then
                    if pending.state == "rejoining" then
                        pending.state = "joining"
                        pending.lastAttemptAt = 0
                    else
                        info.pending = nil
                    end
                elseif not bot:InBattleground() and now - pending.lastAttemptAt >= 1000 then
                    local accepted = LogoutFixedRosterBot(botName)
                    if accepted then
                        pending.lastAttemptAt = now
                    end
                end
            end
        end
    end
end, 1000, 0)

CreateLuaEvent(function ()
    local queuedPlayers = GetPlayersInQueue(bgTypeId, bracketId)
    local realPlayersCount = 0
    local currentTime = GetCurrTime()
    local shouldProc = false
    local longestWait = 0
    local eligiblePlayers = {}
    local queuedByGuid = {}

    for _, player in ipairs(queuedPlayers) do
        queuedByGuid[player:GetGUIDLow()] = player
    end

    if ProcessActiveBGQueuePlayer then
        for _, player in ipairs(queuedPlayers) do
            local guidLow = player:GetGUIDLow()
            local retryAt = wsgController:getRetryAt(guidLow)
            if retryAt and retryAt <= currentTime then
                if ProcessActiveBGQueuePlayer(player, queuedByGuid) then
                    wsgController:setRetryAt(guidLow, nil)
                else
                    wsgController:setRetryAt(guidLow, currentTime + 1000)
                end
            end
        end
    end

    for _, player in ipairs(queuedPlayers) do
        if not wsgController:getPendingInvite(player:GetGUIDLow()) then
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

    sortQueuedPlayers(eligiblePlayers)
    local _, likelyExcludedPlayers = WsgBalance.selectQueuedPlayers(eligiblePlayers)
    warnClassCapPlayers(likelyExcludedPlayers)

    if realPlayersCount == 0 then
        wsgController:setQueueMidpointAlertSent(false)
    elseif longestWait >= (annouceFreq * 1000) and wsgController:isQueueProjectionDirty() then
        local selectedPlayers, excludedPlayers, _, _, decision, summary = wsgController:projectQueuedPlayers(eligiblePlayers)
        warnClassCapPlayers(excludedPlayers)
        warnSplitGroups(summary.splitGroups)
        if not wsgController:isQueueMidpointAlertSent() then
            sendQueueMidpointStatus(selectedPlayers, excludedPlayers, decision, summary)
            wsgController:setQueueMidpointAlertSent(true)
        end
        wsgController:setQueueProjectionDirty(false)
    elseif longestWait < (annouceFreq * 1000) then
        wsgController:setQueueMidpointAlertSent(false)
    end

    local waitSeconds = math.floor(longestWait / 1000)
    if realPlayersCount > 0 and waitSeconds > 0 and waitSeconds % annouceFreq == 0 then
        local timeLeft = queueDelayTime - waitSeconds
        if timeLeft > 0 then
            SendWorldMessage("[WSG Queue] " .. realPlayersCount .. " player(s) waiting in queue. Match starts in " .. timeLeft .. "s.")
        end
    end

    if shouldProc and realPlayersCount > 0 then
        local freshPlan = wsgController:planFreshMatch(eligiblePlayers)
        local selectedPlayers = freshPlan.selectedPlayers
        local excludedPlayers = freshPlan.excludedPlayers
        warnClassCapPlayers(excludedPlayers)
        if #selectedPlayers == 0 then return end

        wsgController:reserveFreshInvites(selectedPlayers)

        local balancedRealPlayers = { [0] = {}, [1] = {} }
        local assignments = freshPlan.assignments
        local bg = CreateBattleground(bgTypeId, bracketId)
        if bg then
            local startedAt = GetCurrTime()
            bg:StartBattleground()
            wsgController:trackActiveBG(bg)

            for _, assignment in ipairs(assignments) do
                local player = assignment.player
                local teamId = assignment.team
                local teamName = teamNames[teamId] or tostring(teamId)
                local grp = player:GetGroup()
                local groupLabel = grp and ("Group#" .. tostring(grp:GetGUID())) or "Solo"

                player:SendBroadcastMessage("[WSG Queue Debug] Assigned to " .. teamName .. " (" .. groupLabel .. ")")

                if player:InviteToBattleground(bg, teamId) then
                    wsgController:recordAcceptedInvite(player, bg:GetInstanceId(), teamId)
                    table.insert(balancedRealPlayers[teamId], player)
                else
                    wsgController:clearPendingInvite(player:GetGUIDLow())
                end
            end


            local targetAllianceBots, targetHordeBots = WsgBalance.calculateBotTargets(
                #balancedRealPlayers[0],
                #balancedRealPlayers[1],
                minPlayersPerTeam
            )
            local targetBots = { [0] = targetAllianceBots, [1] = targetHordeBots }
            local initialBotClasses = { [0] = {}, [1] = {} }
            for team = 0, 1 do
                local needed = targetBots[team]
                if needed > 0 then
                    local otherTeam = team == 0 and 1 or 0
                    local classIds = WsgBalance.selectClassesToAdd(
                        balancedRealPlayers[team],
                        needed,
                        nil,
                        #balancedRealPlayers[team],
                        #balancedRealPlayers[otherTeam]
                    )
                    initialBotClasses[team] = classIds
                end
            end
            ScheduleInitialBotFill(bg, initialBotClasses, startedAt)
            SendWorldMessage("[WSG Queue] Match is starting!")
        end
    end
end, 1000, 0)

local function HasPendingBGInvite(instanceId)
    return wsgController:hasPendingInvite(instanceId)
end

local function CheckBGEmpty(player, mapId, instanceId)
    local instId = (instanceId and instanceId > 0) and instanceId or 0
    local bg = instId > 0 and GetBattleground(instId, bgTypeId) or nil
    if not bg then return false end
    if not isJoinableBattleground(bg) then
        wsgController:untrackActiveBG(instId)
        return true
    end
    wsgController:trackActiveBG(bg)

    local departingName = player and player:GetName() or ""
    local map = GetMapById(mapId or 489, instId)
    if map then
        local departedPlayers = wsgController:getDepartedPlayers(instId)
        for _, p in ipairs(map:GetPlayers()) do
            if not departedPlayers[p:GetGUIDLow()] and p:GetName() ~= departingName and not p:IsBot() then
                return false
            end
        end
    end

    if HasPendingBGInvite(instId) then
        return false
    end

    for guidLow, invite in pairs(wsgController:getPendingInvites()) do
        if invite.instanceId == instId then
            wsgController:clearPlayer(guidLow)
            for _, p in ipairs(GetPlayersInWorld()) do
                if p:GetGUIDLow() == guidLow then
                    p:LeaveBattleground()
                end
            end
        end
    end


    pcall(function()
        bg:EndBattleground(bgTypeId)
        bg:SetEndTime(1)
    end)

    wsgController:untrackActiveBG(instId)
    return true
end

ProcessActiveBGQueuePlayer = function(player, queuedByGuid)
    if not player or player:IsBot() or not queuedByGuid[player:GetGUIDLow()] then return false end
    if not next(wsgController:getActiveBGInstances()) then
        wsgController:setRetryAt(player:GetGUIDLow(), nil)
        return false
    end


    local group = player:GetGroup()
    if group then
        local missingMembers = {}
        for _, member in ipairs(group:GetMembers()) do
            if member and not member:IsBot() and not member:InBattleground() then
                local memberGuid = member:GetGUIDLow()
                if not wsgController:getPendingInvite(memberGuid) and not queuedByGuid[memberGuid] then
                    table.insert(missingMembers, member:GetName())
                end
            end
        end
        if #missingMembers > 0 then
            return false
        end
    end

    for instanceId, _ in pairs(wsgController:getActiveBGInstances()) do
        local bg = GetBattleground(instanceId, bgTypeId)
        if isJoinableBattleground(bg) then
            wsgController:trackActiveBG(bg)
            local map = GetMapById(WSG_MAP_ID, instanceId)
            if map then
                local departedPlayers = wsgController:getDepartedPlayers(instanceId)
                local roster = WsgBalance.extractRoster(map, departedPlayers)
                if roster then
                    local queueGroup = {}
                    if group then
                        for _, member in ipairs(group:GetMembers()) do
                            local memberGuid = member and member:GetGUIDLow()
                            if member and not member:IsBot() and queuedByGuid[memberGuid]
                                and not wsgController:getPendingInvite(memberGuid) and not member:InBattleground() then
                                table.insert(queueGroup, member)
                            end
                        end
                    else
                        table.insert(queueGroup, player)
                    end

                    sortQueuedPlayers(queueGroup)
                    local mapCounts = getMapTeamCounts(map, departedPlayers)
                    local plan, excludedQueueGroup = wsgController:planActiveInvites(
                        queueGroup,
                        roster,
                        instanceId,
                        mapCounts,
                        maxWsgPlayersPerTeam
                    )
                    warnClassCapPlayers(excludedQueueGroup)

                    if plan and #plan.selectedPlayers > 0 then
                        local queueGroup = plan.selectedPlayers
                        local assignments = plan.assignments
                        local decision = plan.decision
                        local allianceCount = roster[0].realCount
                        local hordeCount = roster[1].realCount


                        if #assignments ~= #queueGroup then
                            return false
                        end


                        if not plan.fits then
                            return false
                        end

                        local invitedCount = 0
                        for _, assignment in ipairs(assignments) do
                            local p = assignment.player
                            local teamId = assignment.team
                            local pGuid = p:GetGUIDLow()
                            if p:InviteToBattleground(bg, teamId) then
                                wsgController:recordAcceptedInvite(p, instanceId, teamId)
                                invitedCount = invitedCount + 1
                            else
                            end
                        end
                        return invitedCount == #assignments
                    end
                end
            end
        else
            wsgController:untrackActiveBG(instanceId)
        end
    end

    return false
end

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_ENTER, function(event, player)
    if not player or player:IsBot() or not isWsgQueuePlayer(player) then return end
    local guidLow = player:GetGUIDLow()
    wsgController:clearPlayer(guidLow)
    wsgController:setRetryAt(guidLow, GetCurrTime() + activeBGQueueDelayMs)
    wsgController:setQueueProjectionDirty(true)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_INVITE, function(event, player, mapId, instanceId, bg, teamId)
    if not player or mapId ~= WSG_MAP_ID then return end
end)

local SyncBGPlayerData, BalanceBGBots

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_LEAVE, function(event, player, mapId, instanceId, bg, teamId)
    if not player then return end
    local guidLow = player:GetGUIDLow()
    if (not bg or bg:GetMapId() ~= WSG_MAP_ID) and not wsgController:getPendingInvite(guidLow) and not isWsgQueuePlayer(player) then return end
    local pendingInvite = wsgController:getPendingInvite(guidLow)
    local invitedInstanceId = pendingInvite and pendingInvite.instanceId
    wsgController:clearPlayer(guidLow)
    wsgController:setQueueProjectionDirty(true)


    if invitedInstanceId and not player:IsBot() then
        local bg = GetBattleground(invitedInstanceId, bgTypeId)
        local map = GetMapById(489, invitedInstanceId)
        if map and bg then
            local isEmpty = CheckBGEmpty(player, 489, invitedInstanceId)
            if not isEmpty then
                BalanceBGBots(map, bg, "leave", player:GetName())
                SyncBGPlayerData(map)
            end
        end
    end
end)

SyncBGPlayerData = function(map)
    if not map then return end
    local bots, hordePlayers, alliancePlayers, realPlayers = {}, {}, {}, {}
    for _, p in ipairs(map:GetPlayers()) do
        local name = p:GetName()
        if p:IsBot() then
            table.insert(bots, name)
        else
            table.insert(realPlayers, p)
        end
        if p:GetBgTeamId() == 1 then
            table.insert(hordePlayers, name)
        else
            table.insert(alliancePlayers, name)
        end
    end
    local payload = table.concat(bots, ",") .. ";" .. table.concat(hordePlayers, ",") .. ";" .. table.concat(alliancePlayers, ",")
    for _, p in ipairs(realPlayers) do p:SendAddonMessage("PVP19_SYNC", payload, 7, p) end
end

BalanceBGBots = function(map, bg, triggerEvent, playerName)
    if not map or not bg then return end

    local instId = (type(bg.GetInstanceId) == "function") and bg:GetInstanceId() or 0
    if instId > 0 then
        local freshBg = GetBattleground(instId, bgTypeId)
        if freshBg then
            bg = freshBg
            wsgController:trackActiveBG(freshBg)
        end
    end

    if not isJoinableBattleground(bg) then
        wsgController:untrackActiveBG(instId)
        return
    end

    if not IsBotFillWindowOpen(bg) then return end

    local hasPendingInvites = HasPendingBGInvite(instId)
    local plan = WsgBalance.computeMapBotActions(
        map,
        minPlayersPerTeam,
        nil,
        wsgController:getDepartedPlayers(instId),
        GetPendingBotsForInstance(instId)
    )
    if hasPendingInvites then
        for _, bot in ipairs(plan.toRemove) do
            LogBotRemovalBlocked(bot, instId, "real_player_invite_pending")
        end
        plan.toRemove = {}
        plan.toAdd = { [0] = {}, [1] = {} }
    end

    for _, blocked in ipairs(plan.blockedRemovals or {}) do
        LogBotRemovalBlocked(blocked.bot, instId, blocked.reason)
    end

    local removedBotNames = {}
    for _, bot in ipairs(plan.toRemove) do
        if bot then
            local botName = GetBotName(bot)
            table.insert(removedBotNames, botName)
            if CancelPendingBot(bot, instId) then
            elseif type(bot.LeaveBattleground) == "function" then
                bot:LeaveBattleground()
            else
                LogBotRemovalBlocked(bot, instId, "leave_battleground_api_unavailable")
            end
        end
    end

    local addedInfo = {}
    for team, classIds in pairs(plan.toAdd) do
        if #classIds > 0 then
            table.insert(addedInfo, #classIds .. " " .. (teamNames[team] or tostring(team)))

            for _, classId in ipairs(classIds) do
                AddBotForClass(bg, team, classId)
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
    end
end

-- Periodic BG Balance Check (every 5 seconds)
CreateLuaEvent(function()
    for instanceId, _ in pairs(wsgController:getActiveBGInstances()) do
        local bg = GetBattleground(instanceId, bgTypeId)
        if isJoinableBattleground(bg) then
            wsgController:trackActiveBG(bg)
            local map = GetMapById(489, instanceId)
            if map then
                local hasRealPlayers = false
                local departedPlayers = wsgController:getDepartedPlayers(instanceId)
                for _, p in ipairs(map:GetPlayers()) do
                    if not departedPlayers[p:GetGUIDLow()] and not p:IsBot() then
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
            wsgController:untrackActiveBG(instanceId)
        end
    end
end, 5000, 0)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    if not player or mapId ~= WSG_MAP_ID then return end
    local isBot = player:IsBot()
    local playerName = player:GetName()
    local playerGuidLow = player:GetGUIDLow()

    local enteredBg = GetBattleground(instanceId, bgTypeId)

    wsgController:markPlayerEntered(instanceId, player)
    wsgController:clearPlayer(playerGuidLow)
    if isBot then return end

    CreateLuaEvent(function()
        local bg = GetBattleground(instanceId, bgTypeId)
        local map = GetMapById(mapId or 489, instanceId)
        if map and isJoinableBattleground(bg) then
            BalanceBGBots(map, bg, "join", playerName)
            SyncBGPlayerData(map)
        end
    end, 1000, 1)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    if mapId ~= WSG_MAP_ID then return end
    local botText = (player and player:IsBot()) and "Bot" or "Player"
    local playerName = player and player:GetName() or "Unknown"

    local instId = (instanceId and instanceId > 0) and instanceId or 0
    wsgController:markPlayerLeft(instId, player)
    local realBg = instId > 0 and GetBattleground(instId, bgTypeId) or nil
    local map = GetMapById(mapId, instId)


    if player and player:IsBot() and fixedRoster[playerName] then
        LogoutFixedRosterBotAfterWsg(playerName)
        return
    end

    local isEmpty = CheckBGEmpty(player, mapId, instId)
    if isEmpty or (player and player:IsBot()) then return end

    if map and realBg then
        BalanceBGBots(map, realBg, "leave", playerName)
        SyncBGPlayerData(map)
    end
end)

-- Map changes handle BG balancing and deferred fixed-bot logout.
RegisterPlayerEvent(PLAYER_EVENT_ON_MAP_CHANGE, function(event, player)
    if not player then return end

    local botName = player:GetName()
    local info = fixedRoster[botName]
    local pending = info and info.pending
    if pending and (pending.state == "leaving" or pending.state == "rejoining") and not player:InBattleground() then
        CreateLuaEvent(function()
            if not GetPlayerByName(botName) then
                if pending.state == "rejoining" then
                    pending.state = "joining"
                    pending.lastAttemptAt = 0
                else
                    info.pending = nil
                end
                return
            end

            local accepted = LogoutFixedRosterBot(botName)
            if accepted then
                pending.lastAttemptAt = GetCurrTime()
            else
            end
        end, 1, 1)
        return
    end

    if player:IsBot() then return end
    if player:GetMapId() ~= WSG_MAP_ID then return end
    local inBG = player:InBattleground()

    if inBG then
        local bgId = player:GetBattlegroundId()
        local bgType = player:GetBattlegroundTypeId()
        local bg = (bgId and bgId > 0) and GetBattleground(bgId, (bgType and bgType > 0) and bgType or bgTypeId) or nil
        local map = GetMapById(player:GetMapId(), bgId)
        if isJoinableBattleground(bg) and map then
            BalanceBGBots(map, bg, "join", player:GetName())
            SyncBGPlayerData(map)
        end
    end
end)

RegisterBGEvent(BG_EVENT_ON_END, function(event, bg, bgTypeIdVal, instanceId)
    if not bg or bg:GetMapId() ~= WSG_MAP_ID then return end
    local instId = instanceId or bg:GetInstanceId()
    botFillAt[instId] = nil
    wsgController:untrackActiveBG(instId)

    for guidLow, invite in pairs(wsgController:getPendingInvites()) do
        if invite.instanceId == instId then
            wsgController:clearPlayer(guidLow)
            for _, player in ipairs(GetPlayersInWorld()) do
                if player:GetGUIDLow() == guidLow then
                    player:LeaveBattleground()
                    break
                end
            end
        end
    end

end)

-- Doors Open Hook (BG_EVENT_ON_START = 1)
RegisterBGEvent(BG_EVENT_ON_START, function(event, bg, bgTypeIdVal, instanceId)
    if not bg or bg:GetMapId() ~= WSG_MAP_ID then return end
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

    local hasPendingInvites = HasPendingBGInvite(instId)
    if not hasRealPlayers and not hasPendingInvites then

        -- Retract any remaining pending invites
        for guidLow, invite in pairs(wsgController:getPendingInvites()) do
            if invite.instanceId == instId then
                wsgController:clearPlayer(guidLow)
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
        wsgController:untrackActiveBG(instId)
    elseif not hasRealPlayers then
    end
end)

RegisterServerEvent(ADDON_EVENT_ON_MESSAGE, function(event, sender, type, prefix, msg, target)
    if prefix == "PVP19_INIT" then
        if not sender then
            return false
        end

        local addonVersion = string.match(msg or "", "^VERSION:([%d%.]+)$")
        local response = addonVersion == PVP19_ADDON_VERSION and "SUPPORTED:" or "UPDATE_REQUIRED:"
        local responseMessage = response .. PVP19_SERVER_ID .. ":" .. PVP19_ADDON_VERSION
        sender:SendAddonMessage("PVP19_INIT", responseMessage, 7, sender)
        return false -- Suppress message forwarding
    elseif prefix == "PVP19_QUEUE" then
        local arenaSlot = tonumber(msg)
        if not arenaSlot or arenaSlot < 0 or arenaSlot > 1 or arenaSlot ~= math.floor(arenaSlot) then
            sender:SendAddonMessage("PVP19_QUEUE", "ERROR: invalid arena slot", 7, sender)
            return false
        end

        local ok, queued = pcall(sender.JoinArenaQueue, sender, arenaSlot, false, false)
        if not ok then
            sender:SendAddonMessage("PVP19_QUEUE", "ERROR: server queue call failed", 7, sender)
        elseif queued then
            sender:SendAddonMessage("PVP19_QUEUE", "REQUESTED:" .. tostring(arenaSlot), 7, sender)
        else
            sender:SendAddonMessage("PVP19_QUEUE", "ERROR: server rejected request", 7, sender)
        end
        return false -- Suppress message forwarding
    elseif prefix == "PVP19_SYNC" then
        local map = sender:GetMap()
        if map then
            SyncBGPlayerData(map)
        end
        return false -- Suppress message forwarding
    elseif prefix == "PVP19_DEBUG" then
        if not sender or not sender:IsGM() or msg ~= "REQ" then
            return false
        end
        sendWsgDebug(sender)
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
