local WsgBalance = {}
local MAX_CLASS_PER_TEAM = 2

local function getClassId(player)
    if type(player) ~= "table" and type(player) ~= "userdata" then return 0 end
    if type(player.GetClass) == "function" then return player:GetClass() or 0 end
    return player.class or player.classId or 0
end

local function isBot(player)
    if type(player) ~= "table" and type(player) ~= "userdata" then return false end
    if type(player.IsBot) == "function" then return player:IsBot() end
    return player.isBot == true
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
        table.insert(candidateIncoming, { aInc = aInc, diff = diff, state = state })
    end

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
            if scoreLess(item.state.score, bestItem.state.score) then
                bestItem = item
            elseif not scoreLess(bestItem.state.score, item.state.score) then
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
WsgBalance.groupCandidates = groupCandidates
WsgBalance.MAX_CLASS_PER_TEAM = MAX_CLASS_PER_TEAM

function WsgBalance.selectQueuedPlayers(queuedPlayers, currentClassCounts)
    local availableByClass = {}
    local selected = {}
    local excluded = {}
    local current = currentClassCounts or { [0] = {}, [1] = {} }

    for _, queuedPlayer in ipairs(queuedPlayers or {}) do
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

    return selected, excluded
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

function WsgBalance.selectClassesToAdd(teamPlayers, count, currentBots)
    if not count or count <= 0 then return {} end

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

    -- Warrior is the highest-priority filler unless its fixed bot is already in the BG.
    local selectedClasses = {}
    if not botClasses[1] and (classCounts[1] or 0) < MAX_CLASS_PER_TEAM then
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
                if (classCounts[classId] or 0) < MAX_CLASS_PER_TEAM and not botClasses[classId] then
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

    local realAlliance = (roster[0] and roster[0].realCount) or 0
    local realHorde = (roster[1] and roster[1].realCount) or 0

    local targetAllianceBots, targetHordeBots = WsgBalance.calculateBotTargets(realAlliance, realHorde, minPlayersPerTeam)
    local desiredBots = { [0] = targetAllianceBots, [1] = targetHordeBots }

    for team = 0, 1 do
        local tData = roster[team] or { realCount = 0, bots = {}, players = {} }
        local currentBots = tData.bots or {}
        local currentBotCount = #currentBots
        local targetBotCount = desiredBots[team]

        if currentBotCount > targetBotCount then
            local removeCount = currentBotCount - targetBotCount
            local sortedBots = WsgBalance.sortBotsForRemoval(currentBots, tData.players)
            for i = 1, removeCount do
                table.insert(toRemove, sortedBots[i])
            end
        elseif currentBotCount < targetBotCount then
            local addCount = targetBotCount - currentBotCount
            toAdd[team] = WsgBalance.selectClassesToAdd(tData.players, addCount, tData.bots)
        end
    end

    return {
        toRemove = toRemove,
        toAdd = toAdd,
    }
end

function WsgBalance.extractRoster(map)
    if not map or type(map.GetPlayers) ~= "function" then return nil end

    local roster = {
        [0] = { realCount = 0, bots = {}, players = {}, classCounts = {} },
        [1] = { realCount = 0, bots = {}, players = {}, classCounts = {} },
    }

    for _, p in ipairs(map:GetPlayers()) do
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

    return roster
end

function WsgBalance.computeMapBotActions(map, minPlayersPerTeam, availableBots)
    local roster = WsgBalance.extractRoster(map)
    if not roster then
        return { toRemove = {}, toAdd = { [0] = {}, [1] = {} } }
    end
    return WsgBalance.computeBotActions(roster, minPlayersPerTeam, availableBots)
end

WsgBalance.assignOngoing = WsgBalance.assign

return WsgBalance
