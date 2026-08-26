local WsgBalance = {}
local WsgState = require("wsg-state")
local MAX_CLASS_PER_TEAM = 2
local MAX_PLAYERS_PER_TEAM = 10

local function getClassId(player)
    if type(player) ~= "table" and type(player) ~= "userdata" then return 0 end
    if type(player.GetClass) == "function" then return player:GetClass() or 0 end
    return player.class or player.classId or 0
end

local function getGuidLow(player)
    if type(player) ~= "table" and type(player) ~= "userdata" then return nil end
    if type(player.GetGUIDLow) == "function" then return player:GetGUIDLow() end
    return player.guidLow or player.guid
end

local function nativeDistributionGuidKey(guid)
    -- The ALE C++ bridge parses string keys with std::stoull(..., 0). Keep
    -- this boundary stricter than Lua's normal number/table-key rules.
    if type(guid) == "number" then
        -- Lua numbers cannot represent every 64-bit GUID exactly.
        if guid >= 1 and guid <= 9007199254740991 and guid == math.floor(guid) then
            return string.format("%.0f", guid)
        end
        return nil
    end

    if type(guid) == "string" then
        local digits = string.match(guid, "^(%d+)$")
        if not digits then return nil end

        digits = string.gsub(digits, "^0+", "")
        if digits == "" then digits = "0" end
        if digits == "0" or #digits > 20 then return nil end
        if #digits == 20 and digits > "18446744073709551615" then return nil end

        -- Remove leading zeroes because the native side uses base 0 parsing;
        -- e.g. "08" would otherwise be interpreted as an invalid octal value.
        return digits
    end

    return nil
end

local function nativeDistributionTeamId(teamId)
    if type(teamId) ~= "number" or teamId ~= math.floor(teamId) then return nil end
    if teamId ~= 0 and teamId ~= 1 then return nil end
    return teamId
end

local function isBot(player)
    if type(player) ~= "table" and type(player) ~= "userdata" then return false end
    if type(player.IsBot) == "function" then return player:IsBot() end
    return player.isBot == true
end

local function isFlagCarrier(player)
    if type(player) == "table" then
        if player.isFlagCarrier ~= nil then return player.isFlagCarrier == true end
        if player.flagCarrier ~= nil then return player.flagCarrier == true end
    end
    if type(player) ~= "table" and type(player) ~= "userdata" then return false end
    if type(player.HasAura) ~= "function" then return false end
    return player:HasAura(WSG_HORDE_FLAG_AURA) or player:HasAura(WSG_ALLIANCE_FLAG_AURA)
end

local function hasKnownBotClasses(bots)
    for _, bot in ipairs(bots or {}) do
        if getClassId(bot) <= 0 then return false end
    end
    return true
end

local function copyClassCounts(classCounts)
    local copy = {}
    for classId, count in pairs(classCounts or {}) do
        copy[classId] = count
    end
    return copy
end

local function classCountsKey(classCounts)
    local classIds = {}
    for classId, count in pairs(classCounts or {}) do
        if count > 0 then table.insert(classIds, classId) end
    end
    table.sort(classIds)

    local values = {}
    for _, classId in ipairs(classIds) do
        table.insert(values, tostring(classId) .. ":" .. tostring(classCounts[classId]))
    end
    return table.concat(values, ",")
end

local function stateKey(allianceCount, classCounts)
    return table.concat({
        tostring(allianceCount),
        classCountsKey(classCounts[0]),
        classCountsKey(classCounts[1]),
    }, "|")
end

local function classBalanceScore(classCounts)
    local classIds = {}
    local seen = {}
    for team = 0, 1 do
        for classId, count in pairs(classCounts[team] or {}) do
            if count > 0 and not seen[classId] then
                seen[classId] = true
                table.insert(classIds, classId)
            end
        end
    end

    local score = 0
    for _, classId in ipairs(classIds) do
        score = score + math.abs((classCounts[0][classId] or 0) - (classCounts[1][classId] or 0))
    end
    return score
end

local function addClassCounts(previous, candidate)
    local nextCounts = {
        [0] = copyClassCounts(previous[0]),
        [1] = copyClassCounts(previous[1]),
    }

    for team = 0, 1 do
        for classId, count in pairs(candidate[team] or {}) do
            nextCounts[team][classId] = (nextCounts[team][classId] or 0) + count
            if nextCounts[team][classId] > MAX_CLASS_PER_TEAM then return nil end
        end
    end

    return nextCounts
end

local function shuffle(values)
    for i = #values, 2, -1 do
        local j = math.random(i)
        values[i], values[j] = values[j], values[i]
    end
end

local function scoreLess(left, right)
    if (left.classImbalance or 0) ~= (right.classImbalance or 0) then
        return (left.classImbalance or 0) < (right.classImbalance or 0)
    end
    if left.splitGroups ~= right.splitGroups then return left.splitGroups < right.splitGroups end
    if left.splitPlayers ~= right.splitPlayers then return left.splitPlayers < right.splitPlayers end
    return left.factionMoves < right.factionMoves
end

local function groupCandidates(group)
    local nativeAlliance = {}
    local nativeHorde = {}

    for _, queuedPlayer in ipairs(group.players) do
        local nativeTeam = queuedPlayer.nativeTeam
        assert(nativeTeam == 0 or nativeTeam == 1, "nativeTeam must be 0 or 1")
        table.insert(nativeTeam == 0 and nativeAlliance or nativeHorde, queuedPlayer)
    end

    shuffle(nativeAlliance)
    shuffle(nativeHorde)

    local hasKnownClass = false
    for _, queuedPlayer in ipairs(group.players) do
        if getClassId(queuedPlayer.player) > 0 or (queuedPlayer.classId and queuedPlayer.classId > 0) then
            hasKnownClass = true
            break
        end
    end

    local function makeCandidate(assignments, allianceCount)
        local classCounts = { [0] = {}, [1] = {} }
        local factionMoves = 0
        for _, assignment in ipairs(assignments) do
            local queuedPlayer = assignment.queuedPlayer
            local classId = queuedPlayer.classId or getClassId(queuedPlayer.player)
            if classId and classId > 0 then
                classCounts[assignment.team][classId] = (classCounts[assignment.team][classId] or 0) + 1
            end
            if queuedPlayer.nativeTeam ~= assignment.team then factionMoves = factionMoves + 1 end
        end

        local publicAssignments = {}
        for _, assignment in ipairs(assignments) do
            table.insert(publicAssignments, {
                player = assignment.player,
                team = assignment.team,
                classId = assignment.queuedPlayer.classId or getClassId(assignment.player),
            })
        end

        return {
            allianceCount = allianceCount,
            assignments = publicAssignments,
            classCounts = classCounts,
            splitGroups = allianceCount > 0 and allianceCount < #group.players and 1 or 0,
            splitPlayers = math.min(allianceCount, #group.players - allianceCount),
            factionMoves = factionMoves,
        }
    end

    local candidates = {}
    local groupSize = #group.players

    -- Preserve the compact candidate set for callers that do not provide class data.
    if hasKnownClass then
        local states = {
            [stateKey(0, { [0] = {}, [1] = {} })] = {
                allianceCount = 0,
                classCounts = { [0] = {}, [1] = {} },
                assignments = {},
                factionMoves = 0,
            },
        }

        for _, queuedPlayer in ipairs(group.players) do
            local nextStates = {}
            local classId = queuedPlayer.classId or getClassId(queuedPlayer.player)
            for _, previous in pairs(states) do
                for team = 0, 1 do
                    local classCounts = {
                        [0] = copyClassCounts(previous.classCounts[0]),
                        [1] = copyClassCounts(previous.classCounts[1]),
                    }
                    if classId and classId > 0 then
                        classCounts[team][classId] = (classCounts[team][classId] or 0) + 1
                    end
                    if not classId or classId <= 0 or classCounts[team][classId] <= MAX_CLASS_PER_TEAM then
                        local assignments = {}
                        for _, assignment in ipairs(previous.assignments) do
                            table.insert(assignments, assignment)
                        end
                        table.insert(assignments, {
                            queuedPlayer = queuedPlayer,
                            player = queuedPlayer.player,
                            team = team,
                        })

                        local nextState = {
                            allianceCount = previous.allianceCount + (team == 0 and 1 or 0),
                            classCounts = classCounts,
                            assignments = assignments,
                            factionMoves = previous.factionMoves + (queuedPlayer.nativeTeam ~= team and 1 or 0),
                        }
                        local key = stateKey(nextState.allianceCount, classCounts)
                        local current = nextStates[key]
                        if not current or nextState.factionMoves < current.factionMoves
                            or (nextState.factionMoves == current.factionMoves and math.random(2) == 1) then
                            nextStates[key] = nextState
                        end
                    end
                end
            end
            states = nextStates
        end

        for _, state in pairs(states) do
            table.insert(candidates, makeCandidate(state.assignments, state.allianceCount))
        end
        return candidates
    end

    for allianceCount = 0, groupSize do
        local allianceNativesKept = math.min(allianceCount, #nativeAlliance)
        local hordeMovedToAlliance = allianceCount - allianceNativesKept
        local assignments = {}

        for i, queuedPlayer in ipairs(nativeAlliance) do
            table.insert(assignments, {
                queuedPlayer = queuedPlayer,
                player = queuedPlayer.player,
                team = i <= allianceNativesKept and 0 or 1,
            })
        end
        for i, queuedPlayer in ipairs(nativeHorde) do
            table.insert(assignments, {
                queuedPlayer = queuedPlayer,
                player = queuedPlayer.player,
                team = i <= hordeMovedToAlliance and 0 or 1,
            })
        end

        candidates[#candidates + 1] = makeCandidate(assignments, allianceCount)
    end

    return candidates
end

local function shouldReplace(current, candidate)
    return not current or scoreLess(candidate.score, current.score)
        or (not scoreLess(current.score, candidate.score) and math.random(2) == 1)
end

function WsgBalance.assign(groups, currentAlliance, currentHorde, lastFavoredTeam, currentClassCounts)
    currentAlliance = currentAlliance or 0
    currentHorde = currentHorde or 0

    local incomingPlayers = 0
    local incomingAlliance = 0
    for _, group in ipairs(groups) do
        incomingPlayers = incomingPlayers + #group.players
        for _, queuedPlayer in ipairs(group.players) do
            if queuedPlayer.nativeTeam == 0 then incomingAlliance = incomingAlliance + 1 end
        end
    end
    local initialClassCounts = {
        [0] = copyClassCounts(currentClassCounts and currentClassCounts[0]),
        [1] = copyClassCounts(currentClassCounts and currentClassCounts[1]),
    }
    local states = {
        [stateKey(0, initialClassCounts)] = {
            allianceCount = 0,
            classCounts = initialClassCounts,
            score = { splitGroups = 0, splitPlayers = 0, factionMoves = 0 },
        },
    }

    shuffle(groups)
    for _, group in ipairs(groups) do
        local nextStates = {}
        for _, previous in pairs(states) do
            for _, candidate in ipairs(groupCandidates(group)) do
                local classCounts = addClassCounts(previous.classCounts, candidate.classCounts)
                if classCounts then
                    local allianceAfter = previous.allianceCount + candidate.allianceCount
                    local nextState = {
                        allianceCount = allianceAfter,
                        classCounts = classCounts,
                        previous = previous,
                        candidate = candidate,
                        score = {
                            classImbalance = classBalanceScore(classCounts),
                            splitGroups = previous.score.splitGroups + candidate.splitGroups,
                            splitPlayers = previous.score.splitPlayers + candidate.splitPlayers,
                            factionMoves = previous.score.factionMoves + candidate.factionMoves,
                        },
                    }
                    local key = stateKey(allianceAfter, classCounts)
                    if shouldReplace(nextStates[key], nextState) then
                        nextStates[key] = nextState
                    end
                end
            end
        end
        states = nextStates
    end

    local candidateIncoming = {}
    for _, state in pairs(states) do
        local aInc = state.allianceCount
        local aFinal = currentAlliance + aInc
        local hFinal = currentHorde + (incomingPlayers - aInc)
        local diff = math.abs(aFinal - hFinal)
        if aFinal <= MAX_PLAYERS_PER_TEAM and hFinal <= MAX_PLAYERS_PER_TEAM then
            table.insert(candidateIncoming, { aInc = aInc, diff = diff, state = state })
        end
    end

    -- Team size is the first heuristic: only equally balanced candidates
    -- compete on class parity, group preservation, and faction preservation.
    local minDiff = math.huge
    for _, item in ipairs(candidateIncoming) do
        if item.diff < minDiff then minDiff = item.diff end
    end

    local validCandidates = {}
    for _, item in ipairs(candidateIncoming) do
        if item.diff == minDiff then table.insert(validCandidates, item) end
    end

    local bestItem = nil
    for _, item in ipairs(validCandidates) do
        if not bestItem then
            bestItem = item
        else
            local itemClassImbalance = item.state.score.classImbalance or classBalanceScore(item.state.classCounts)
            local bestClassImbalance = bestItem.state.score.classImbalance or classBalanceScore(bestItem.state.classCounts)
            if itemClassImbalance < bestClassImbalance then
                bestItem = item
            elseif itemClassImbalance == bestClassImbalance and scoreLess(item.state.score, bestItem.state.score) then
                bestItem = item
            elseif itemClassImbalance == bestClassImbalance and not scoreLess(bestItem.state.score, item.state.score) then
                if lastFavoredTeam == 0 and item.aInc > bestItem.aInc then
                    bestItem = item
                elseif lastFavoredTeam == 1 and item.aInc < bestItem.aInc then
                    bestItem = item
                elseif lastFavoredTeam == nil and math.random(2) == 1 then
                    bestItem = item
                end
            end
        end
    end

    local best = bestItem and bestItem.state
    local assignments = {}
    while best and best.candidate do
        for _, assignment in ipairs(best.candidate.assignments) do
            assignments[#assignments + 1] = assignment
        end
        best = best.previous
    end

    shuffle(assignments)
    
    local newAlliance = currentAlliance + (bestItem and bestItem.aInc or 0)
    local newHorde = currentHorde + (incomingPlayers - (bestItem and bestItem.aInc or 0))
    local nextFavoredTeam = nil
    if newAlliance < newHorde then
        nextFavoredTeam = 0
    elseif newHorde < newAlliance then
        nextFavoredTeam = 1
    else
        nextFavoredTeam = lastFavoredTeam
    end

    return assignments, nextFavoredTeam, {
        currentAlliance = currentAlliance,
        currentHorde = currentHorde,
        incomingAlliance = incomingAlliance,
        incomingHorde = incomingPlayers - incomingAlliance,
        assignedAlliance = bestItem and bestItem.aInc or 0,
        assignedHorde = incomingPlayers - (bestItem and bestItem.aInc or 0),
        finalAlliance = newAlliance,
        finalHorde = newHorde,
        finalDifference = math.abs(newAlliance - newHorde),
        finalClassCounts = bestItem and bestItem.state.classCounts or initialClassCounts,
        score = bestItem and bestItem.state.score or nil,
    }
end

WsgBalance.scoreLess = scoreLess
WsgBalance.classBalanceScore = classBalanceScore
WsgBalance.nativeDistributionGuidKey = nativeDistributionGuidKey
WsgBalance.nativeDistributionTeamId = nativeDistributionTeamId
WsgBalance.groupCandidates = groupCandidates
WsgBalance.MAX_CLASS_PER_TEAM = MAX_CLASS_PER_TEAM
WsgBalance.MAX_PLAYERS_PER_TEAM = MAX_PLAYERS_PER_TEAM

function WsgBalance.compactRaidSubgroups(group)
    local members = {}
    for _, player in ipairs(group:GetMembers()) do
        local guid = player:GetGUID()
        table.insert(members, { guid = guid, subgroup = group:GetMemberGroup(guid) })
    end

    table.sort(members, function(left, right)
        return left.subgroup < right.subgroup
    end)

    local moved = 0
    for index, member in ipairs(members) do
        local targetSubgroup = math.floor((index - 1) / 5)
        if member.subgroup ~= targetSubgroup then
            group:SetMembersGroup(member.guid, targetSubgroup)
            moved = moved + 1
        end
    end
    return moved
end

function WsgBalance.selectQueuedPlayers(queuedPlayers, currentClassCounts)
    local availableByClass = {}
    local selected = {}
    local excluded = {}
    local current = currentClassCounts or { [0] = {}, [1] = {} }

    for _, queuedPlayer in ipairs(queuedPlayers or {}) do
        if #selected >= MAX_PLAYERS_PER_TEAM * 2 then
            table.insert(excluded, queuedPlayer)
        else
            local classId = queuedPlayer.classId or queuedPlayer.class or getClassId(queuedPlayer.player or queuedPlayer)
            if classId > 0 and availableByClass[classId] == nil then
                availableByClass[classId] = 0
                for team = 0, 1 do
                    availableByClass[classId] = availableByClass[classId]
                        + math.max(0, MAX_CLASS_PER_TEAM - ((current[team] or {})[classId] or 0))
                end
            end

            if classId <= 0 or availableByClass[classId] > 0 then
                table.insert(selected, queuedPlayer)
                if classId > 0 then availableByClass[classId] = availableByClass[classId] - 1 end
            else
                table.insert(excluded, queuedPlayer)
            end
        end
    end

    return selected, excluded
end

function WsgBalance.describeAssignments(groups, assignments)
    local teamCounts = { [0] = 0, [1] = 0 }
    local classCounts = { [0] = {}, [1] = {} }
    local teamByPlayer = {}

    for _, assignment in ipairs(assignments or {}) do
        teamCounts[assignment.team] = teamCounts[assignment.team] + 1
        teamByPlayer[assignment.player] = assignment.team
        if assignment.classId and assignment.classId > 0 then
            local counts = classCounts[assignment.team]
            counts[assignment.classId] = (counts[assignment.classId] or 0) + 1
        end
    end

    local splitGroups = {}
    for _, group in ipairs(groups or {}) do
        local firstTeam = nil
        local split = false
        local assignedPlayers = 0
        for _, queuedPlayer in ipairs(group.players) do
            local team = teamByPlayer[queuedPlayer.player]
            if team ~= nil then
                assignedPlayers = assignedPlayers + 1
                if firstTeam == nil then firstTeam = team elseif firstTeam ~= team then split = true end
            end
        end
        if assignedPlayers == #group.players and split then table.insert(splitGroups, group) end
    end

    return {
        teamCounts = teamCounts,
        classCounts = classCounts,
        splitGroups = splitGroups,
    }
end

function WsgBalance.groupQueuedPlayers(queuedPlayers)
    local groupsByKey = {}
    local groups = {}

    for _, player in ipairs(queuedPlayers) do
        local group = type(player.GetGroup) == "function" and player:GetGroup() or nil
        local key
        if group then
            key = "group:" .. tostring(group:GetGUID())
        elseif type(player.GetGUID) == "function" then
            key = "solo:" .. tostring(player:GetGUID())
        elseif type(player.GetGUIDLow) == "function" then
            key = "solo:" .. tostring(player:GetGUIDLow())
        elseif type(player) == "table" and player.name then
            key = "solo:" .. tostring(player.name)
        else
            key = "solo:" .. tostring(player)
        end

        if not groupsByKey[key] then
            groupsByKey[key] = { players = {} }
            groups[#groups + 1] = groupsByKey[key]
        end

        local pObj = player.player or player
        local team = player.nativeTeam or (type(player.GetTeam) == "function" and player:GetTeam() or 0)
        table.insert(groupsByKey[key].players, {
            player = pObj,
            nativeTeam = team,
            classId = player.classId or player.class or getClassId(pObj),
        })
    end

    return groups
end

function WsgBalance.calculateBotTargets(realAlliance, realHorde, minPlayersPerTeam)
    minPlayersPerTeam = minPlayersPerTeam or 5
    realAlliance = realAlliance or 0
    realHorde = realHorde or 0

    if realAlliance == 0 and realHorde == 0 then return 0, 0 end

    local targetAlliance = math.max(0, minPlayersPerTeam - realAlliance)
    local targetHorde = math.max(0, minPlayersPerTeam - realHorde)

    -- Keep one Warrior on the team that is behind, even after both teams
    -- have passed the normal five-player bot-filler threshold.
    if realAlliance < realHorde then targetAlliance = math.max(targetAlliance, 1) end
    if realHorde < realAlliance then targetHorde = math.max(targetHorde, 1) end

    return targetAlliance, targetHorde
end

local CLASS_PRIORITY = {
    [1]  = 1, -- Warrior
    [11] = 2, -- Druid
    [8]  = 3, -- Mage
    [5]  = 4, -- Priest
    [4]  = 5, -- Rogue
}

local function getClassPriority(classId)
    return CLASS_PRIORITY[classId] or (10 + (classId or 99))
end

function WsgBalance.selectClassesToAdd(teamPlayers, count, currentBots, teamRealCount, opposingRealCount)
    if not count or count <= 0 then return {} end

    local allowWarrior = false
    if type(teamRealCount) == "boolean" then
        -- Keep the helper convenient for isolated callers/tests.
        allowWarrior = teamRealCount
    elseif type(teamRealCount) == "number" and type(opposingRealCount) == "number" then
        allowWarrior = teamRealCount < opposingRealCount
    end

    local classCounts = {}
    local presentClasses = {}
    local botClasses = {}
    if teamPlayers then
        for _, p in ipairs(teamPlayers) do
            if not isBot(p) then
                local c = getClassId(p)
                if c > 0 then
                    classCounts[c] = (classCounts[c] or 0) + 1
                    presentClasses[c] = true
                end
            end
        end
    end
    if currentBots then
        for _, bot in ipairs(currentBots) do
            local c = getClassId(bot)
            if c > 0 then botClasses[c] = true end
        end
    end

    -- The fixed Warrior is reserved for the team that is behind on real
    -- players. Other filler classes can still be used on equal teams.
    local selectedClasses = {}
    if allowWarrior and not botClasses[1] and (classCounts[1] or 0) < MAX_CLASS_PER_TEAM then
        selectedClasses[1] = 1
        classCounts[1] = (classCounts[1] or 0) + 1
    end

    while #selectedClasses < count do
        local chosenClass = nil

        for _, classId in ipairs({ 11, 8, 5, 4 }) do
            if not presentClasses[classId] and (classCounts[classId] or 0) < MAX_CLASS_PER_TEAM and not botClasses[classId] then
                chosenClass = classId
                break
            end
        end

        if not chosenClass then
            for _, classId in ipairs({ 11, 8, 5, 4, 1 }) do
                if (classId ~= 1 or allowWarrior)
                    and (classCounts[classId] or 0) < MAX_CLASS_PER_TEAM
                    and not botClasses[classId] then
                    chosenClass = classId
                    break
                end
            end
        end

        if not chosenClass then break end
        table.insert(selectedClasses, chosenClass)
        classCounts[chosenClass] = (classCounts[chosenClass] or 0) + 1
        presentClasses[chosenClass] = true
    end

    return selectedClasses
end

function WsgBalance.sortBotsForRemoval(currentBots, teamPlayers)
    if not currentBots or #currentBots == 0 then return {} end

    local classCounts = {}
    if teamPlayers then
        for _, p in ipairs(teamPlayers) do
            local c = getClassId(p)
            if c > 0 then
                classCounts[c] = (classCounts[c] or 0) + 1
            end
        end
    end

    local candidates = {}
    for _, bot in ipairs(currentBots) do
        table.insert(candidates, bot)
    end

    table.sort(candidates, function(a, b)
        local aCarrier = isFlagCarrier(a)
        local bCarrier = isFlagCarrier(b)
        if aCarrier ~= bCarrier then return not aCarrier end

        local cA = getClassId(a)
        local cB = getClassId(b)

        local aDup = (classCounts[cA] or 0) > 1
        local bDup = (classCounts[cB] or 0) > 1
        if aDup ~= bDup then return aDup end

        local pA = getClassPriority(cA)
        local pB = getClassPriority(cB)
        if pA ~= pB then return pA > pB end

        local nA = type(a.GetName) == "function" and a:GetName() or tostring(a)
        local nB = type(b.GetName) == "function" and b:GetName() or tostring(b)
        return nA < nB
    end)

    return candidates
end

function WsgBalance.computeBotActions(roster, minPlayersPerTeam)
    minPlayersPerTeam = minPlayersPerTeam or 5
    local toRemove = {}
    local toAdd = { [0] = {}, [1] = {} }
    local blockedRemovals = {}
    local blockedRemovalSet = {}

    local function blockRemoval(bot, reason)
        if blockedRemovalSet[bot] then return end
        blockedRemovalSet[bot] = true
        table.insert(blockedRemovals, { bot = bot, reason = reason })
    end

    local realAlliance = (roster[0] and roster[0].realCount) or 0
    local realHorde = (roster[1] and roster[1].realCount) or 0

    local targetAllianceBots, targetHordeBots = WsgBalance.calculateBotTargets(realAlliance, realHorde, minPlayersPerTeam)
    local desiredBots = { [0] = targetAllianceBots, [1] = targetHordeBots }

    for team = 0, 1 do
        local tData = roster[team] or { realCount = 0, bots = {}, players = {} }
        local currentBots = tData.bots or {}
        local currentBotCount = #currentBots
        local targetBotCount = desiredBots[team]
        local teamRealCount = team == 0 and realAlliance or realHorde
        local opposingRealCount = team == 0 and realHorde or realAlliance
        local sortedBots = WsgBalance.sortBotsForRemoval(currentBots, tData.players)
        local teamRemovals = {}

        if currentBotCount > targetBotCount then
            local removeCount = currentBotCount - targetBotCount
            for _, bot in ipairs(sortedBots) do
                if #teamRemovals < removeCount then
                    if isFlagCarrier(bot) then
                        blockRemoval(bot, "flag_carrier")
                    else
                        table.insert(toRemove, bot)
                        table.insert(teamRemovals, bot)
                    end
                end
            end
        elseif currentBotCount < targetBotCount then
            local addCount = targetBotCount - currentBotCount
            toAdd[team] = WsgBalance.selectClassesToAdd(
                tData.players,
                addCount,
                tData.bots,
                teamRealCount,
                opposingRealCount
            )
        end

        -- Keep the bot count stable while correcting a missing trailing Warrior.
        -- If the current replacement candidate carries the flag, wait until the
        -- carrier drops it; the next balance pass can then swap it out safely.
        if targetBotCount > 0 and currentBotCount >= targetBotCount and hasKnownBotClasses(currentBots) then
            local desiredClass = WsgBalance.selectClassesToAdd(
                tData.players,
                1,
                currentBots,
                teamRealCount,
                opposingRealCount
            )[1]
            if desiredClass == 1 then
                if #teamRemovals == 0 then
                    for _, bot in ipairs(sortedBots) do
                        if isFlagCarrier(bot) then
                            blockRemoval(bot, "flag_carrier")
                        else
                            table.insert(toRemove, bot)
                            table.insert(teamRemovals, bot)
                            break
                        end
                    end
                end
                if #teamRemovals > 0 then
                    table.insert(toAdd[team], 1, desiredClass)
                end
            end
        end
    end

    return {
        toRemove = toRemove,
        toAdd = toAdd,
        blockedRemovals = blockedRemovals,
    }
end

function WsgBalance.extractRoster(map, excludedGuids)
    if not map or type(map.GetPlayers) ~= "function" then return nil end

    local roster = {
        [0] = { realCount = 0, bots = {}, players = {}, classCounts = {} },
        [1] = { realCount = 0, bots = {}, players = {}, classCounts = {} },
    }

    for _, p in ipairs(map:GetPlayers()) do
        local guidLow = getGuidLow(p)
        if not excludedGuids or not guidLow or not excludedGuids[guidLow] then
            local team = type(p.GetBgTeamId) == "function" and p:GetBgTeamId() or (p.team or 0)
            if team == 0 or team == 1 then
                table.insert(roster[team].players, p)
                local isBot = type(p.IsBot) == "function" and p:IsBot() or (p.isBot == true)
                if isBot then
                    table.insert(roster[team].bots, p)
                else
                    roster[team].realCount = roster[team].realCount + 1
                    local classId = getClassId(p)
                    if classId > 0 then
                        roster[team].classCounts[classId] = (roster[team].classCounts[classId] or 0) + 1
                    end
                end
            end
        end
    end

    return roster
end

function WsgBalance.computeMapBotActions(map, minPlayersPerTeam, availableBots, excludedGuids, pendingBots)
    local roster = WsgBalance.extractRoster(map, excludedGuids)
    if not roster then
        return { toRemove = {}, toAdd = { [0] = {}, [1] = {} } }
    end

    local presentBotNames = {}
    for team = 0, 1 do
        for _, bot in ipairs(roster[team].bots) do
            local name = type(bot) == "table" and bot.name or nil
            if not name and (type(bot) == "table" or type(bot) == "userdata")
                and type(bot.GetName) == "function" then
                name = bot:GetName()
            end
            if name then presentBotNames[name] = true end
        end
    end

    -- A fixed-roster bot can be reserved for this BG while it is still offline
    -- or waiting to enter. Count that reservation so repeated balance passes do
    -- not request the same bot again before the map snapshot catches up.
    for _, bot in ipairs(pendingBots or {}) do
        local team = bot.teamId or bot.team
        local name = bot.name
        if (team == 0 or team == 1) and name and not presentBotNames[name] then
            bot.isBot = true
            bot.pending = true
            table.insert(roster[team].bots, bot)
            table.insert(roster[team].players, bot)
            presentBotNames[name] = true
        end
    end

    return WsgBalance.computeBotActions(roster, minPlayersPerTeam, availableBots)
end

-- Queue state is deliberately kept separate from ALE objects.  The game script
-- owns the controller; tests can exercise these transitions with plain tables.
function WsgBalance.createQueueController(initialState)
    local state = initialState or WsgState.create()

    local controller = {}

    function controller:setPendingInvite(player, instanceId, teamId)
        local guidLow = type(player.GetGUIDLow) == "function" and player:GetGUIDLow() or player.guidLow
        state.pendingInvites[guidLow] = {
            instanceId = instanceId,
            teamId = teamId,
            classId = getClassId(player),
        }
    end

    function controller:getPendingInvite(guidLow)
        return state.pendingInvites[guidLow]
    end

    function controller:clearPendingInvite(guidLow)
        state.pendingInvites[guidLow] = nil
    end

    function controller:clearPlayer(guidLow)
        state.pendingInvites[guidLow] = nil
        state.classCapWarnings[guidLow] = nil
        state.groupSplitWarnings[guidLow] = nil
        state.activeQueueRetryAt[guidLow] = nil
    end

    function controller:getPendingInvites()
        return state.pendingInvites
    end

    function controller:hasPendingInvite(instanceId)
        if not instanceId or instanceId <= 0 then return false end
        for _, invite in pairs(state.pendingInvites) do
            if invite.instanceId == instanceId or invite.instanceId == true then return true end
        end
        return false
    end

    function controller:getTeamCountsWithPending(instanceId, baseCounts, assignments)
        local teamCounts = {
            [0] = (baseCounts and baseCounts[0]) or 0,
            [1] = (baseCounts and baseCounts[1]) or 0,
        }
        for _, invite in pairs(state.pendingInvites) do
            if invite.instanceId == instanceId and (invite.teamId == 0 or invite.teamId == 1) then
                teamCounts[invite.teamId] = teamCounts[invite.teamId] + 1
            end
        end
        for _, assignment in ipairs(assignments or {}) do
            if assignment.team == 0 or assignment.team == 1 then
                teamCounts[assignment.team] = teamCounts[assignment.team] + 1
            end
        end
        return teamCounts
    end

    function controller:getPendingTeamCounts(instanceId)
        local teamCounts = { [0] = 0, [1] = 0 }
        for _, invite in pairs(state.pendingInvites) do
            if invite.instanceId == instanceId and (invite.teamId == 0 or invite.teamId == 1) then
                teamCounts[invite.teamId] = teamCounts[invite.teamId] + 1
            end
        end
        return teamCounts
    end

    function controller:getClassCounts(instanceId, roster)
        local classCounts = { [0] = {}, [1] = {} }
        for team = 0, 1 do
            for classId, count in pairs((roster[team] and roster[team].classCounts) or {}) do
                classCounts[team][classId] = count
            end
        end

        for _, invite in pairs(state.pendingInvites) do
            if invite.instanceId == instanceId then
                local teamId = invite.teamId
                local classId = invite.classId
                if (teamId == 0 or teamId == 1) and classId and classId > 0 then
                    classCounts[teamId][classId] = (classCounts[teamId][classId] or 0) + 1
                end
            end
        end
        return classCounts
    end

    function controller:trackActiveBG(bg)
        if bg and type(bg.GetInstanceId) == "function" then
            state.activeBGInstances[bg:GetInstanceId()] = bg
        end
    end

    function controller:trackActiveInstance(instanceId, bg)
        if instanceId and instanceId > 0 then state.activeBGInstances[instanceId] = bg or true end
    end

    function controller:untrackActiveBG(instanceId)
        if instanceId and instanceId > 0 then
            state.activeBGInstances[instanceId] = nil
            self:clearDepartedPlayers(instanceId)
        end
    end

    function controller:getActiveBGInstances()
        return state.activeBGInstances
    end

    function controller:markPlayerLeft(instanceId, player)
        local guidLow = getGuidLow(player)
        if not instanceId or instanceId <= 0 or not guidLow then return end
        state.departedPlayers[instanceId] = state.departedPlayers[instanceId] or {}
        state.departedPlayers[instanceId][guidLow] = true
    end

    function controller:markPlayerEntered(instanceId, player)
        local guidLow = getGuidLow(player)
        if not instanceId or instanceId <= 0 or not guidLow then return end
        WsgState.recordParticipant(state, instanceId, player)
        local departed = state.departedPlayers[instanceId]
        if not departed then return end
        departed[guidLow] = nil
        if next(departed) == nil then state.departedPlayers[instanceId] = nil end
    end

    function controller:getDepartedPlayers(instanceId)
        return state.departedPlayers[instanceId] or {}
    end

    function controller:clearDepartedPlayers(instanceId)
        if instanceId and instanceId > 0 then state.departedPlayers[instanceId] = nil end
    end

    function controller:getRetryAt(guidLow)
        return state.activeQueueRetryAt[guidLow]
    end

    function controller:setRetryAt(guidLow, retryAt)
        state.activeQueueRetryAt[guidLow] = retryAt
    end

    function controller:hasClassCapWarning(guidLow)
        return state.classCapWarnings[guidLow] == true
    end

    function controller:markClassCapWarning(guidLow)
        state.classCapWarnings[guidLow] = true
    end

    function controller:clearClassCapWarning(guidLow)
        state.classCapWarnings[guidLow] = nil
    end

    function controller:hasGroupSplitWarning(guidLow)
        return state.groupSplitWarnings[guidLow] == true
    end

    function controller:markGroupSplitWarning(guidLow)
        state.groupSplitWarnings[guidLow] = true
    end

    function controller:clearGroupSplitWarning(guidLow)
        state.groupSplitWarnings[guidLow] = nil
    end

    function controller:isQueueMidpointAlertSent()
        return state.queueMidpointAlertSent
    end

    function controller:setQueueMidpointAlertSent(value)
        state.queueMidpointAlertSent = value == true
    end

    function controller:isQueueProjectionDirty()
        return state.queueProjectionDirty
    end

    function controller:setQueueProjectionDirty(value)
        state.queueProjectionDirty = value == true
    end

    function controller:projectQueuedPlayers(players)
        local selectedPlayers, excludedPlayers = WsgBalance.selectQueuedPlayers(players)
        local groups = WsgBalance.groupQueuedPlayers(selectedPlayers)
        local assignments, _, decision = WsgBalance.assign(groups)
        return selectedPlayers, excludedPlayers, groups, assignments, decision,
            WsgBalance.describeAssignments(groups, assignments)
    end

    function controller:planFreshMatch(players)
        local selectedPlayers, excludedPlayers, groups, assignments, decision, summary =
            self:projectQueuedPlayers(players)
        return {
            selectedPlayers = selectedPlayers,
            excludedPlayers = excludedPlayers,
            groups = groups,
            assignments = assignments,
            decision = decision,
            summary = summary,
        }
    end

    function controller:reserveFreshInvites(players)
        for _, player in ipairs(players or {}) do
            self:setPendingInvite(player, true)
            local guidLow = type(player.GetGUIDLow) == "function" and player:GetGUIDLow() or player.guidLow
            self:clearClassCapWarning(guidLow)
            self:clearGroupSplitWarning(guidLow)
        end
    end

    function controller:recordAcceptedInvite(player, instanceId, teamId)
        local guidLow = type(player.GetGUIDLow) == "function" and player:GetGUIDLow() or player.guidLow
        self:setPendingInvite(player, instanceId, teamId)
        self:clearClassCapWarning(guidLow)
        self:clearGroupSplitWarning(guidLow)
        self:setRetryAt(guidLow, nil)
    end

    function controller:planActiveInvites(queuePlayers, roster, instanceId, mapCounts, maxPlayersPerTeam)
        local classCounts = self:getClassCounts(instanceId, roster)
        local pendingTeamCounts = self:getPendingTeamCounts(instanceId)
        local selectedPlayers, excludedPlayers = WsgBalance.selectQueuedPlayers(queuePlayers, classCounts)
        if #selectedPlayers == 0 then
            return nil, excludedPlayers, classCounts
        end

        local grouped = WsgBalance.groupQueuedPlayers(selectedPlayers)
        local assignments, _, decision = WsgBalance.assign(
            grouped,
            roster[0].realCount + pendingTeamCounts[0],
            roster[1].realCount + pendingTeamCounts[1],
            nil,
            classCounts
        )
        if #assignments ~= #selectedPlayers then
            return {
                assignments = assignments,
                selectedPlayers = selectedPlayers,
                excludedPlayers = excludedPlayers,
                classCounts = classCounts,
                decision = decision,
                fits = false,
                reason = "group_assignment",
            }, excludedPlayers, classCounts
        end

        local teamCounts = self:getTeamCountsWithPending(instanceId, mapCounts, assignments)
        local fits = teamCounts[0] <= maxPlayersPerTeam and teamCounts[1] <= maxPlayersPerTeam
        return {
            assignments = assignments,
            selectedPlayers = selectedPlayers,
            excludedPlayers = excludedPlayers,
            classCounts = classCounts,
            decision = decision,
            teamCounts = teamCounts,
            fits = fits,
            reason = fits and nil or "player_capacity",
        }, excludedPlayers, classCounts
    end

    return controller
end

return WsgBalance
