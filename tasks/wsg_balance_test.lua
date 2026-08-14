package.path = "core_scripts/?.lua;" .. package.path

local balance = require("wsg_balance")

local function player(name, nativeTeam, classId)
    return { player = name, nativeTeam = nativeTeam, classId = classId }
end

local function run(groups)
    local assignments = balance.assign(groups)
    local counts = { [0] = 0, [1] = 0 }
    local classCounts = { [0] = {}, [1] = {} }
    local teams = {}
    for _, assignment in ipairs(assignments) do
        counts[assignment.team] = counts[assignment.team] + 1
        if assignment.classId and assignment.classId > 0 then
            classCounts[assignment.team][assignment.classId] = (classCounts[assignment.team][assignment.classId] or 0) + 1
            assert(classCounts[assignment.team][assignment.classId] <= balance.MAX_CLASS_PER_TEAM,
                string.format("Class cap failed: class %d has %d players on team %d", assignment.classId, classCounts[assignment.team][assignment.classId], assignment.team))
        end
        teams[assignment.player] = assignment.team
    end

    -- Rule 1: Never have more than 1 player difference between teams
    local diff = math.abs(counts[0] - counts[1])
    assert(diff <= 1, string.format("Team difference failed: Alliance %d vs Horde %d (diff %d > 1)", counts[0], counts[1], diff))
    
    return teams, counts
end

local function runWithCurrentRoster(groups, currentAlliance, currentHorde, lastFavoredTeam, currentClassCounts)
    local assignments, nextFavored, decision = balance.assign(
        groups,
        currentAlliance,
        currentHorde,
        lastFavoredTeam,
        currentClassCounts
    )
    local counts = { [0] = currentAlliance, [1] = currentHorde }
    local classCounts = {
        [0] = {},
        [1] = {},
    }
    for team = 0, 1 do
        for classId, count in pairs((currentClassCounts and currentClassCounts[team]) or {}) do
            classCounts[team][classId] = count
        end
    end

    local teams = {}
    local expectedAssignments = 0
    for _, group in ipairs(groups) do expectedAssignments = expectedAssignments + #group.players end
    assert(#assignments == expectedAssignments, "All feasible queued players must receive an assignment")

    for _, assignment in ipairs(assignments) do
        counts[assignment.team] = counts[assignment.team] + 1
        teams[assignment.player] = assignment.team
        if assignment.classId and assignment.classId > 0 then
            local classId = assignment.classId
            classCounts[assignment.team][classId] = (classCounts[assignment.team][classId] or 0) + 1
            assert(classCounts[assignment.team][classId] <= balance.MAX_CLASS_PER_TEAM,
                string.format("Ongoing class cap failed: class %d has %d players on team %d", classId, classCounts[assignment.team][classId], assignment.team))
        end
    end

    local diff = math.abs(counts[0] - counts[1])
    assert(diff <= 1, string.format("Ongoing team difference failed: %dA vs %dH", counts[0], counts[1]))
    return teams, counts, nextFavored, decision, assignments, classCounts
end

math.randomseed(19)

print("--- Running WSG Balance Test Suite ---")

-- 1. Unbreakable Rule: Max 1 player difference across varying player counts and party sizes
print("[Test 1] Max 1 player difference across 100 random team setups...")
for seed = 1, 100 do
    math.randomseed(seed)
    local totalPlayers = math.random(1, 20)
    local remaining = totalPlayers
    local groups = {}
    local pId = 1
    while remaining > 0 do
        local gSize = math.min(remaining, math.random(1, 5))
        local gPlayers = {}
        for i = 1, gSize do
            table.insert(gPlayers, player("p" .. pId, math.random(0, 1)))
            pId = pId + 1
        end
        table.insert(groups, { players = gPlayers })
        remaining = remaining - gSize
    end
    local _, counts = run(groups)
    assert(math.abs(counts[0] - counts[1]) <= 1)
end
print("  -> PASSED: All 100 setups respected max 1 player difference.")

-- 1b. Unbreakable Rule: No more than 2 players of one class per team
print("[Test 1b] Max 2 players of each class per team...")
local classHeavyMatch = run({
    { players = { player("w1", 0, 1) } },
    { players = { player("w2", 0, 1) } },
    { players = { player("w3", 0, 1) } },
    { players = { player("w4", 0, 1) } },
    { players = { player("d1", 1, 11) } },
    { players = { player("d2", 1, 11) } },
    { players = { player("d3", 1, 11) } },
    { players = { player("d4", 1, 11) } },
})
assert(classHeavyMatch.w1 ~= classHeavyMatch.w2 or classHeavyMatch.w2 ~= classHeavyMatch.w3,
    "Four players of one class must be distributed across both teams")
print("  -> PASSED: Class-heavy queue respects the 2-per-class team cap.")

-- 1ba. Class parity is preferred over preserving native factions when team sizes tie.
print("[Test 1ba] Prefer class parity over faction parity...")
local mixedClassAssignments = balance.assign({
    { players = { player("allianceRogue1", 0, 4) } },
    { players = { player("allianceRogue2", 0, 4) } },
    { players = { player("hordeDruid1", 1, 11) } },
    { players = { player("hordeDruid2", 1, 11) } },
})
local mixedClassCounts = { [0] = {}, [1] = {} }
for _, assignment in ipairs(mixedClassAssignments) do
    local counts = mixedClassCounts[assignment.team]
    counts[assignment.classId] = (counts[assignment.classId] or 0) + 1
end
assert(mixedClassCounts[0][4] == 1 and mixedClassCounts[1][4] == 1,
    "Two Alliance rogues must be split for class parity")
assert(mixedClassCounts[0][11] == 1 and mixedClassCounts[1][11] == 1,
    "Two Horde druids must be split for class parity")
print("  -> PASSED: Equal-size teams prioritize one rogue and one druid per team.")

-- 1c. Class-cap overflow keeps the oldest queued players and defers the newest.
print("[Test 1c] Class-cap overflow keeps queue order...")
local orderedWarriors = {}
for i = 1, 5 do table.insert(orderedWarriors, player("queuedWarr" .. i, i % 2, 1)) end
local selectedWarriors, excludedWarriors = balance.selectQueuedPlayers(orderedWarriors)
assert(#selectedWarriors == 4 and #excludedWarriors == 1, "Only four same-class players fit in a fresh WSG")
for i = 1, 4 do
    assert(selectedWarriors[i].player == "queuedWarr" .. i, "Older same-class players must be selected first")
end
assert(excludedWarriors[1].player == "queuedWarr5", "The latest same-class player must wait for the next match")

local activeSelected, activeExcluded = balance.selectQueuedPlayers(
    { player("activeWarr1", 0, 1), player("activeWarr2", 1, 1) },
    { [0] = { [1] = 2 }, [1] = { [1] = 1 } }
)
assert(#activeSelected == 1 and activeSelected[1].player == "activeWarr1", "Active-BG class capacity must keep the oldest eligible player")
assert(#activeExcluded == 1 and activeExcluded[1].player == "activeWarr2", "Active-BG class overflow must defer the newest player")

local unknownSelected, unknownExcluded = balance.selectQueuedPlayers({ player("unknown", 0, 0) })
assert(#unknownSelected == 1 and #unknownExcluded == 0, "Unknown class data must never be excluded by the class cap")
print("  -> PASSED: Class-cap overflow is deterministic and oldest-first.")

-- 1d. When one of four in-BG same-class players leaves, the oldest waiting player gets the slot.
print("[Test 1d] Oldest waiting player fills a freed class slot...")
local waitingAfterLeave = {
    player("waitingWarr1", 0, 1),
    player("waitingWarr2", 1, 1),
}
local selectedAfterLeave, excludedAfterLeave = balance.selectQueuedPlayers(waitingAfterLeave, {
    [0] = { [1] = 1 }, -- One Alliance warrior remains after the leave.
    [1] = { [1] = 2 }, -- Horde still has two warriors.
})
assert(#selectedAfterLeave == 1 and selectedAfterLeave[1].player == "waitingWarr1",
    "The oldest waiting same-class player must get the freed slot")
assert(#excludedAfterLeave == 1 and excludedAfterLeave[1].player == "waitingWarr2",
    "The newer waiting same-class player must remain queued")

local leaveReplacementAssignments = balance.assign(
    { { players = { selectedAfterLeave[1] } } },
    1,
    2,
    nil,
    { [0] = { [1] = 1 }, [1] = { [1] = 2 } }
)
assert(#leaveReplacementAssignments == 1 and leaveReplacementAssignments[1].team == 0,
    "The oldest waiting player must join the team that lost its class member")
print("  -> PASSED: Oldest waiting player fills the freed class slot.")

-- 1e. Queue projections expose projected team sizes, class distribution, and forced group splits.
print("[Test 1e] Queue projection status and split metadata...")
local projectedSplitGroup = { players = { player("projectedA", 0, 1), player("projectedB", 0, 8) } }
local projectedGroups = { projectedSplitGroup }
local projectedAssignments = balance.assign(projectedGroups)
local projectedSummary = balance.describeAssignments(projectedGroups, projectedAssignments)
assert(projectedSummary.teamCounts[0] + projectedSummary.teamCounts[1] == 2, "Queue projection must count every assigned player")
assert((projectedSummary.classCounts[0][1] or 0) + (projectedSummary.classCounts[1][1] or 0) == 1,
    "Queue projection must expose class distribution")
assert(#projectedSummary.splitGroups == 1, "A two-player solo group must be reported as split in the projection")
print("  -> PASSED: Queue projection exposes team, class, and split information.")

-- 2. Prefer keeping groups intact when balance permits
print("[Test 2] Keep groups intact when team balance permits...")

-- 2a: 2v2 (1 Alliance party of 2, 1 Horde party of 2)
local pairMatch = run({
    { players = { player("a1", 0), player("a2", 0) } },
    { players = { player("h1", 1), player("h2", 1) } },
})
assert(pairMatch.a1 == pairMatch.a2, "Alliance group of 2 should remain intact")
assert(pairMatch.h1 == pairMatch.h2, "Horde group of 2 should remain intact")
assert(pairMatch.a1 ~= pairMatch.h1, "Alliance and Horde groups should be on opposite teams")

-- 2b: 3v3 (1 Alliance party of 3, 1 Horde party of 3)
local trioMatch = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1) } },
})
assert(trioMatch.a1 == trioMatch.a2 and trioMatch.a2 == trioMatch.a3, "Alliance trio should remain intact")
assert(trioMatch.h1 == trioMatch.h2 and trioMatch.h2 == trioMatch.h3, "Horde trio should remain intact")
assert(trioMatch.a1 ~= trioMatch.h1, "Alliance and Horde trios should be on opposite teams")

-- 2c: 5v5 (5 Alliance party, 3 Horde party, 2 Horde party)
local raidMatch = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1) } },
    { players = { player("h4", 1), player("h5", 1) } },
})
assert(raidMatch.a1 == raidMatch.a2 and raidMatch.a2 == raidMatch.a3 and raidMatch.a3 == raidMatch.a4 and raidMatch.a4 == raidMatch.a5, "5-player group should remain intact")
assert(raidMatch.h1 == raidMatch.h2 and raidMatch.h2 == raidMatch.h3, "3-player group should remain intact")
assert(raidMatch.h4 == raidMatch.h5, "2-player group should remain intact")
print("  -> PASSED: Groups remain intact whenever team balance permits.")

-- 3. Split groups ONLY when necessary to maintain <= 1 player diff
print("[Test 3] Split groups ONLY when necessary...")

-- 3a: 2-player group alone in queue (Total 2) -> Must split 1v1
local forcedPairSplit = run({ { players = { player("a", 0), player("b", 0) } } })
assert(forcedPairSplit.a ~= forcedPairSplit.b, "Single 2-player group alone must split to achieve 1v1")

local function isGroupSplit(teams, playerList)
    local firstTeam = teams[playerList[1]]
    for i = 2, #playerList do
        if teams[playerList[i]] ~= firstTeam then
            return true
        end
    end
    return false
end

-- 3b: 6-player group + 4-player group (Total 10) -> Must split to achieve 5v5
local forcedRaidSplit = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0), player("a6", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1), player("h4", 1) } },
})
local aSplit = isGroupSplit(forcedRaidSplit, { "a1", "a2", "a3", "a4", "a5", "a6" })
local hSplit = isGroupSplit(forcedRaidSplit, { "h1", "h2", "h3", "h4" })
assert(aSplit or hSplit, "6v4 groups must split at least one player to achieve 5v5")
print("  -> PASSED: Groups split only when necessary.")

-- 4. Preserve native factions when balance permits
print("[Test 4] Respect native factions when balance permits...")
local nativeMatch = run({
    { players = { player("a1", 0) } },
    { players = { player("a2", 0) } },
    { players = { player("h1", 1) } },
    { players = { player("h2", 1) } },
})
assert(nativeMatch.a1 == 0 and nativeMatch.a2 == 0, "Alliance solos should stay Alliance")
assert(nativeMatch.h1 == 1 and nativeMatch.h2 == 1, "Horde solos should stay Horde")
print("  -> PASSED: Native factions preserved.")

-- 5. Split selection variation (fairness in who gets moved)
print("[Test 5] Randomized split selection fairness...")
local moved = {}
for seed = 1, 30 do
    math.randomseed(seed)
    local splitPair = run({ { players = { player("a", 0), player("b", 0) } } })
    moved[splitPair.a == 1 and "a" or "b"] = true
end
assert(moved.a and moved.b, "Split selection should vary randomly between group members")
print("  -> PASSED: Split selection is randomized.")

-- 6. Ongoing Battleground Join Balancing
print("[Test 6] Ongoing Battleground Join Balancing...")

-- Helper for ongoing BG tests
local function runOngoing(groups, curA, curH, lastFavored)
    local assignments, nextFavored = balance.assign(groups, curA, curH, lastFavored)
    local aInc, hInc = 0, 0
    local teams = {}
    for _, a in ipairs(assignments) do
        if a.team == 0 then aInc = aInc + 1 else hInc = hInc + 1 end
        teams[a.player] = a.team
    end
    local finalA = curA + aInc
    local finalH = curH + hInc
    assert(math.abs(finalA - finalH) <= 1, string.format("Ongoing BG diff failed: %dA vs %dH", finalA, finalH))
    return teams, finalA, finalH, nextFavored
end

-- 6a: 4A vs 5H, group of 2H joins -> Both added to Alliance (6A vs 5H), group kept intact
local teams6a, finalA6a, finalH6a = runOngoing({ { players = { player("h1", 1), player("h2", 1) } } }, 4, 5)
assert(finalA6a == 6 and finalH6a == 5, "4A vs 5H + 2 players must yield 6A vs 5H")
assert(teams6a.h1 == 0 and teams6a.h2 == 0, "Group of 2 joining 4A vs 5H must be added intact to Alliance")

-- 6b: 3A vs 5H, 1 player joins -> Added to Alliance (4A vs 5H)
local _, finalA6b, finalH6b = runOngoing({ { players = { player("p1", 0) } } }, 3, 5)
assert(finalA6b == 4 and finalH6b == 5, "3A vs 5H + 1 player must yield 4A vs 5H")

-- 6c: Equal teams 5A vs 5H + 1 player, lastFavoredTeam = 0 (Alliance needed) -> Added to Alliance (6A vs 5H)
local teams6c, finalA6c, finalH6c, nextFavored6c = runOngoing({ { players = { player("p1", 0) } } }, 5, 5, 0)
assert(finalA6c == 6 and finalH6c == 5, "Equal 5A vs 5H with Alliance favored must add player to Alliance")
assert(nextFavored6c == 1, "Next favored team after 6A vs 5H should be Horde (1)")

-- 6d: 4A vs 5H, group of 3 joins -> Must split (2 to Alliance, 1 to Horde) -> 6A vs 6H
local teams6d, finalA6d, finalH6d = runOngoing({ { players = { player("p1", 1), player("p2", 1), player("p3", 1) } } }, 4, 5)
assert(finalA6d == 6 and finalH6d == 6, "4A vs 5H + 3 players must yield 6A vs 6H")
local p1Team, p2Team, p3Team = teams6d.p1, teams6d.p2, teams6d.p3
assert(not (p1Team == p2Team and p2Team == p3Team), "Group of 3 joining 4A vs 5H must split to achieve 6A vs 6H")

print("  -> PASSED: Ongoing BG join balancing handles unbalance, equal teams, and group splitting.")

-- 6e: 1A vs 0H, one Alliance-native player joins -> Assign to Horde (1A vs 1H)
local lateQueueAssignments, _, lateQueueDecision = balance.assign(
    balance.groupQueuedPlayers({ player("lateAlliance", 0) }),
    1,
    0
)
assert(#lateQueueAssignments == 1 and lateQueueAssignments[1].team == 1, "1A vs 0H late queue player must be assigned to Horde")
assert(lateQueueDecision.finalAlliance == 1 and lateQueueDecision.finalHorde == 1, "Late queue assignment must produce a balanced 1A vs 1H roster")

-- 6f: Existing team already has 2 Warriors; equal teams and Alliance preference must still assign the new Warrior to Horde.
local cappedJoinAssignments = balance.assign(
    { { players = { player("cappedWarrior", 0, 1) } } },
    2,
    2,
    0,
    { [0] = { [1] = 2 }, [1] = {} }
)
assert(#cappedJoinAssignments == 1 and cappedJoinAssignments[1].team == 1,
    "A third Warrior cannot join the team that already has 2 Warriors")

-- 6g: In-progress BG with existing real-player class counts. The incoming group must place
-- the capped Warrior on Horde and the capped Mage on Alliance while still ending 6v6.
local activeTeams, activeCounts = runWithCurrentRoster(
    { { players = {
        player("activeWarrior", 0, 1),
        player("activeDruid", 0, 11),
        player("activeMage", 1, 8),
    } } },
    4,
    5,
    nil,
    { [0] = { [1] = 2, [11] = 1 }, [1] = { [1] = 1, [8] = 2 } }
)
assert(activeCounts[0] == 6 and activeCounts[1] == 6, "Active BG class-constrained join must remain balanced at 6v6")
assert(activeTeams.activeWarrior == 1, "Incoming Warrior must avoid Alliance's two Warriors")
assert(activeTeams.activeMage == 0, "Incoming Mage must avoid Horde's two Mages")

-- 6h: A class capped on one side must be excluded even when the favored side would otherwise win the tie.
local excludedClassTeams = runWithCurrentRoster(
    { { players = { player("excludedMage", 0, 8) } } },
    5,
    5,
    0,
    { [0] = { [8] = 2 }, [1] = {} }
)
assert(excludedClassTeams.excludedMage == 1, "A capped class must be assigned to the other team")

-- 6i: If both teams already have two players of a class, the class-cap rule has no feasible assignment.
local impossibleClassJoin = balance.assign(
    { { players = { player("impossibleWarrior", 0, 1) } } },
    5,
    5,
    nil,
    { [0] = { [1] = 2 }, [1] = { [1] = 2 } }
)
assert(#impossibleClassJoin == 0, "A class capped on both teams must not be assigned")

-- 6j: Empty BG, 10-player group with five class pairs -> Must split 5v5 without breaking the cap.
local largeClassGroup = { players = {} }
for i, classId in ipairs({ 1, 1, 11, 11, 8, 8, 5, 5, 4, 4 }) do
    table.insert(largeClassGroup.players, player("large" .. i, 0, classId))
end
local _, largeCounts = run({ largeClassGroup })
assert(largeCounts[0] == 5 and largeCounts[1] == 5, "Large class-composed group must split into 5v5")

-- 6k: Queue groups of every common size together; all players must be assigned and both hard rules hold.
local variedSizeGroups = {}
local variedId = 1
for size = 1, 5 do
    local groupPlayers = {}
    for _ = 1, size do
        local classId = ({ 1, 11, 8, 5, 4 })[((variedId - 1) % 5) + 1]
        table.insert(groupPlayers, player("varied" .. variedId, size % 2, classId))
        variedId = variedId + 1
    end
    table.insert(variedSizeGroups, { players = groupPlayers })
end
local _, variedCounts = run(variedSizeGroups)
assert(variedCounts[0] + variedCounts[1] == 15, "All varied-size group players must be assigned")

-- 7. Exposed Helper API Functions
print("[Test 7] Exposed API Functions and edge cases...")

-- 7a: Test balance.scoreLess
assert(balance.nativeDistributionGuidKey(28001) == "28001", "Numeric native distribution GUIDs must become canonical decimal strings")
assert(balance.nativeDistributionGuidKey("28001") == "28001", "Decimal native distribution GUID strings must be accepted")
assert(balance.nativeDistributionGuidKey("Player-1-28001") == nil, "Formatted GUID strings must never cross the native numeric bridge")
assert(balance.scoreLess({ classImbalance = 0, splitGroups = 0, splitPlayers = 0, factionMoves = 2 },
    { classImbalance = 2, splitGroups = 0, splitPlayers = 0, factionMoves = 0 }) == true,
    "Class imbalance must outrank faction movement in candidate scoring")
assert(balance.scoreLess({ splitGroups = 0, splitPlayers = 0, factionMoves = 0 }, { splitGroups = 1, splitPlayers = 0, factionMoves = 0 }) == true)
assert(balance.scoreLess({ splitGroups = 1, splitPlayers = 0, factionMoves = 0 }, { splitGroups = 0, splitPlayers = 0, factionMoves = 0 }) == false)
assert(balance.scoreLess({ splitGroups = 0, splitPlayers = 0, factionMoves = 0 }, { splitGroups = 0, splitPlayers = 1, factionMoves = 0 }) == true)
assert(balance.scoreLess({ splitGroups = 0, splitPlayers = 1, factionMoves = 0 }, { splitGroups = 0, splitPlayers = 0, factionMoves = 1 }) == false)
assert(balance.scoreLess({ splitGroups = 0, splitPlayers = 1, factionMoves = 0 }, { splitGroups = 0, splitPlayers = 1, factionMoves = 1 }) == true)

-- 7b: Test balance.groupCandidates
local testGroup = { players = { player("p1", 0), player("p2", 0) } }
local candidates = balance.groupCandidates(testGroup)
assert(#candidates == 3, "2-player group must generate 3 candidates (0, 1, 2 alliance counts)")
local knownClassCandidates = balance.groupCandidates({
    players = { player("knownP1", 0, 1), player("knownP2", 0, 1), player("knownP3", 1, 8) },
})
assert(#knownClassCandidates > 0, "Class-aware group candidate generation must return feasible candidates")
for _, candidate in ipairs(knownClassCandidates) do
    assert(#candidate.assignments == 3, "Every feasible class-aware candidate must assign the whole group")
    for team = 0, 1 do
        for classId, count in pairs(candidate.classCounts[team]) do
            assert(count <= balance.MAX_CLASS_PER_TEAM, "Class-aware candidates must respect the per-team class cap")
        end
    end
end

-- 7c: Test balance.groupQueuedPlayers
local fakePlayers = {
    { player = "p1", nativeTeam = 0, class = 1 },
    { player = "p2", nativeTeam = 1, class = 11 },
}
local grouped = balance.groupQueuedPlayers(fakePlayers)
assert(#grouped == 2, "Solo players should form 2 distinct group buckets")
assert(grouped[1].players[1].classId == 1 and grouped[2].players[1].classId == 11, "Queued grouping preserves player class IDs")
assert(#balance.groupQueuedPlayers({}) == 0, "Empty queued-player input must produce no groups")

-- 7d: Test balance.describeAssignments for split, intact, partial, and empty projections.
local intactGroup = { players = { player("intact1", 0, 1), player("intact2", 0, 8) } }
local intactSummary = balance.describeAssignments({ intactGroup }, {
    { player = "intact1", team = 0, classId = 1 },
    { player = "intact2", team = 0, classId = 8 },
})
assert(intactSummary.teamCounts[0] == 2 and intactSummary.teamCounts[1] == 0, "Assignment summary must count team sizes")
assert(intactSummary.classCounts[0][1] == 1 and intactSummary.classCounts[0][8] == 1, "Assignment summary must count classes per team")
assert(#intactSummary.splitGroups == 0, "Intact groups must not appear in split metadata")

local splitSummary = balance.describeAssignments({ intactGroup }, {
    { player = "intact1", team = 0, classId = 1 },
    { player = "intact2", team = 1, classId = 8 },
})
assert(#splitSummary.splitGroups == 1 and splitSummary.splitGroups[1] == intactGroup, "Split groups must be reported by identity")

local partialSummary = balance.describeAssignments({ intactGroup }, {
    { player = "intact1", team = 0, classId = 1 },
})
assert(#partialSummary.splitGroups == 0, "Partially assigned groups must not be reported as split")
local emptySummary = balance.describeAssignments({}, {})
assert(emptySummary.teamCounts[0] == 0 and emptySummary.teamCounts[1] == 0 and #emptySummary.splitGroups == 0,
    "Empty assignment projections must return empty summary data")

-- 7f: Direct empty/default behavior for queue and bot helpers.
local emptySelected, emptyExcluded = balance.selectQueuedPlayers({})
assert(#emptySelected == 0 and #emptyExcluded == 0, "Empty queue filtering must return two empty lists")
local defaultTargetsA, defaultTargetsH = balance.calculateBotTargets(1, 0)
assert(defaultTargetsA == 4 and defaultTargetsH == 5, "Bot target helper must default to five players per team")
assert(#balance.selectClassesToAdd({}, 0) == 0, "Zero bot additions must return an empty class list")
assert(#balance.sortBotsForRemoval({}, nil) == 0, "Empty bot removal input must return an empty list")

local sparseBotPlan = balance.computeBotActions({ [0] = { realCount = 0, bots = {}, players = {} } }, 5)
assert(#sparseBotPlan.toRemove == 0 and #sparseBotPlan.toAdd[0] == 0 and #sparseBotPlan.toAdd[1] == 0,
    "Sparse roster data must safely produce an empty bot plan")
assert(balance.extractRoster(nil) == nil, "Invalid map input must return no roster")
local invalidMapPlan = balance.computeMapBotActions(nil, 5)
assert(#invalidMapPlan.toRemove == 0 and #invalidMapPlan.toAdd[0] == 0 and #invalidMapPlan.toAdd[1] == 0,
    "Invalid map input must produce an empty map bot plan")

-- 8. Bot Target Calculation Tests
print("[Test 8] Dynamic Bot Target Calculation...")

-- 8a: 1A vs 0H -> Needs 4 Alliance bots, 5 Horde bots (User Example 1)
local bA1, bH1 = balance.calculateBotTargets(1, 0, 5)
assert(bA1 == 4 and bH1 == 5, "1A vs 0H needs 4 Alliance bots and 5 Horde bots")

-- 8b: 1A vs 1H -> Needs 4 Alliance bots, 4 Horde bots (1 Horde bot leaves! User Example 2)
local bA2, bH2 = balance.calculateBotTargets(1, 1, 5)
assert(bA2 == 4 and bH2 == 4, "1A vs 1H needs 4 Alliance bots and 4 Horde bots")

-- 8c: 5A vs 5H -> Needs 0 Alliance bots, 0 Horde bots (User Example 3: no bots when 5v5 real players)
local bA3, bH3 = balance.calculateBotTargets(5, 5, 5)
assert(bA3 == 0 and bH3 == 0, "5A vs 5H needs 0 bots")

-- 8d: 6A vs 5H keeps one Warrior bot on the trailing Horde team.
local bA4, bH4 = balance.calculateBotTargets(6, 5, 5)
assert(bA4 == 0 and bH4 == 1, "6A vs 5H keeps one Horde Warrior bot")

-- 8e: The trailing team still gets its Warrior above the normal five-player threshold.
assert(select(1, balance.calculateBotTargets(7, 8, 5)) == 1
    and select(2, balance.calculateBotTargets(7, 8, 5)) == 0,
    "7A vs 8H needs one Alliance Warrior bot")

-- 8f: Test computeBotActions diff computation (User Example 2: 1 Horde bot removed when 2nd real player enters)
local plan1 = balance.computeBotActions({
    [0] = { realCount = 1, bots = { "botA1", "botA2", "botA3", "botA4" } },
    [1] = { realCount = 1, bots = { "botH1", "botH2", "botH3", "botH4", "botH5" } },
}, 5)
assert(#plan1.toRemove == 1 and plan1.toRemove[1] == "botH1", "computeBotActions must return 1 Horde bot to remove when 2nd real player joins")
assert(#plan1.toAdd[0] == 0 and #plan1.toAdd[1] == 0, "No bots to add")

-- 8g: Edge Case 10v9: the trailing team retains its Warrior balance bot.
local plan10v9 = balance.computeBotActions({
    [0] = { realCount = 10, bots = {} },
    [1] = { realCount = 9, bots = { { class = 1 } } },
}, 5)
assert(#plan10v9.toRemove == 0 and #plan10v9.toAdd[0] == 0 and #plan10v9.toAdd[1] == 0,
    "10A vs 9H must retain exactly one Horde Warrior bot")

;(function()
    local plan10v10AfterJoin = balance.computeBotActions({
        [0] = { realCount = 10, bots = {} },
        [1] = { realCount = 10, bots = { { class = 1 } } },
    }, 5)
    assert(#plan10v10AfterJoin.toRemove == 1 and plan10v10AfterJoin.toRemove[1].class == 1,
        "A joining player that makes 10A vs 10H must remove the trailing Warrior bot")
end)()

-- 8h: Edge Case Full Capacity (Alliance: 5 real + 6 bots; Horde: 4 real + 4 bots). 5th real player joins Alliance -> 6 Alliance bots + 3 Horde bots removed
local planFullCap = balance.computeBotActions({
    [0] = { realCount = 5, bots = { "botA1", "botA2", "botA3", "botA4", "botA5", "botA6" } },
    [1] = { realCount = 4, bots = { "botH1", "botH2", "botH3", "botH4" } },
}, 5)
assert(#planFullCap.toRemove == 9, "Full capacity edge case: 6 Alliance bots and 3 Horde bots removed to reach target counts")

-- 8i: Ongoing group join (2 Alliance real + 3 bots vs 1 Horde real + 4 bots). Group of 2 real Horde players joins -> Horde real becomes 3 -> 2 Horde bots leave
local planGroupJoin = balance.computeBotActions({
    [0] = { realCount = 2, bots = { "botA1", "botA2", "botA3" } },
    [1] = { realCount = 3, bots = { "botH1", "botH2", "botH3", "botH4" } },
}, 5)
assert(#planGroupJoin.toRemove == 2, "Ongoing group join: 2 Horde bots removed when 2 real players join Horde")

-- 8j: Over 10 real players (6 Alliance real + 2 bots vs 5 Horde real + 3 bots) -> trailing team keeps one Warrior bot
local planOver10 = balance.computeBotActions({
    [0] = { realCount = 6, bots = { "botA1", "botA2" } },
    [1] = { realCount = 5, bots = { "botH1", "botH2", "botH3" } },
}, 5)
assert(#planOver10.toRemove == 4 and #planOver10.toAdd[0] == 0 and #planOver10.toAdd[1] == 0,
    "6A vs 5H must remove extra bots but keep one Horde Warrior target")

;(function()
    local extraWarriorPlan = balance.computeBotActions({
        [0] = { realCount = 6, bots = { { class = 1 } } },
        [1] = { realCount = 5, bots = {} },
    }, 5)
    assert(#extraWarriorPlan.toRemove == 1 and extraWarriorPlan.toRemove[1].class == 1
        and #extraWarriorPlan.toAdd[1] == 1 and extraWarriorPlan.toAdd[1][1] == 1,
        "6A vs 5H must remove the extra Alliance Warrior and add the trailing Horde Warrior")
end)()

print("  -> PASSED: Bot target calculations, 10v9 edge cases, capacity frees, and group join bot diffs verified.")

-- 9. Player Leave Bot Replacement (No mid-match team swaps)
print("[Test 9] Player Leave Bot Replacement (No mid-match team swaps)...")

-- 9a: 1 Real Alliance player leaves (real Alliance drops from 4 to 3 vs 5H real) -> 1 Alliance bot added to fill slot (real diff becomes 2, 0 team swaps!)
local leavePlan1 = balance.computeBotActions({
    [0] = { realCount = 3, bots = { "botA1" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#leavePlan1.toRemove == 0, "No bots removed when real player leaves")
assert(#leavePlan1.toAdd[0] == 1 and #leavePlan1.toAdd[1] == 0, "1 Alliance bot added to replace leaving real player (3A real + 2 bots = 5A total vs 5H real)")

-- 9b: 2 Real Alliance players leave (real Alliance drops to 2 vs 5H real) -> 2 Alliance bots added to fill slots (real diff becomes 3, 0 team swaps!)
local leavePlan2 = balance.computeBotActions({
    [0] = { realCount = 2, bots = { "botA1" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#leavePlan2.toRemove == 0, "No bots removed when 2 real players leave")
assert(#leavePlan2.toAdd[0] == 2 and #leavePlan2.toAdd[1] == 0, "2 Alliance bots added to replace 2 leaving real players (2A real + 3 bots = 5A total vs 5H real)")

-- 9c: Subsequent real player joins after leave (2A real + 3 bots vs 5H real) -> Assigns to Alliance (2A < 5H), 1 Alliance bot removed!
local joinAfterLeaveAssigns, _ = balance.assign({ { players = { player("newA", 0) } } }, 2, 5)
assert(#joinAfterLeaveAssigns == 1 and joinAfterLeaveAssigns[1].team == 0, "New player assigned to Alliance (2A < 5H)")
local joinAfterLeaveBotPlan = balance.computeBotActions({
    [0] = { realCount = 3, bots = { "botA1", "botA2", "botA3" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#joinAfterLeaveBotPlan.toRemove == 1 and joinAfterLeaveBotPlan.toRemove[1] == "botA1", "1 Alliance bot removed as new real player joins Alliance")

print("  -> PASSED: Player leaves are filled by bots without team swaps, and subsequent joins replace bots.")

-- 10. Large Group & Composition Boundaries
print("[Test 10] Large Group & Composition Boundaries...")

-- 10a: Full 5-man party queues alone in empty queue -> Splits 3v2 (or 2v3) to satisfy strict Rule #1 (|A - H| <= 1)
local g5AssignsEmpty, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } } })
local c5Empty = { [0] = 0, [1] = 0 }
for _, a in ipairs(g5AssignsEmpty) do c5Empty[a.team] = c5Empty[a.team] + 1 end
assert((c5Empty[0] == 3 and c5Empty[1] == 2) or (c5Empty[0] == 2 and c5Empty[1] == 3), "5-man party in empty queue splits 3v2 to satisfy Rule #1 (|A-H| <= 1)")

-- 10b: Full 5-man party joins ongoing BG with 4 Horde real players -> Kept 100% INTACT on Alliance (5A vs 4H, diff 1 <= 1)
local g5AssignsOngoing, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } } }, 0, 4)
local g5Team = g5AssignsOngoing[1].team
for _, a in ipairs(g5AssignsOngoing) do
    assert(a.team == 0, "5-man party joining 0A vs 4H ongoing BG stays 100% INTACT on Alliance")
end

-- 10c: 10-man raid party queues together -> Must split 5v5
local g10Assigns, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0), player("a6", 0), player("a7", 0), player("a8", 0), player("a9", 0), player("a10", 0) } } })
local c10 = { [0] = 0, [1] = 0 }
for _, a in ipairs(g10Assigns) do c10[a.team] = c10[a.team] + 1 end
assert(c10[0] == 5 and c10[1] == 5, "10-man party must split 5v5")

-- 10d: 4-man + 4-man parties (Total 8) -> Both kept intact (4v4)
local g44Assigns, _ = balance.assign({
    { players = { player("p1", 0), player("p2", 0), player("p3", 0), player("p4", 0) } },
    { players = { player("q1", 1), player("q2", 1), player("q3", 1), player("q4", 1) } },
})
local teamOfPlayer = {}
for _, a in ipairs(g44Assigns) do
    local pObj = (type(a.player) == "table" and a.player.player) or a.player
    local pName = type(pObj) == "table" and pObj.name or tostring(pObj)
    teamOfPlayer[pName] = a.team
end

assert(teamOfPlayer["p1"] == teamOfPlayer["p2"] and teamOfPlayer["p2"] == teamOfPlayer["p3"] and teamOfPlayer["p3"] == teamOfPlayer["p4"], "Group 1 (p1..p4) intact")
assert(teamOfPlayer["q1"] == teamOfPlayer["q2"] and teamOfPlayer["q2"] == teamOfPlayer["q3"] and teamOfPlayer["q3"] == teamOfPlayer["q4"], "Group 2 (q1..q4) intact")
assert(teamOfPlayer["p1"] ~= teamOfPlayer["q1"], "Group 1 and Group 2 placed on opposite teams")

print("  -> PASSED: Large groups and raid parties handled correctly under Rule #1 constraints.")

-- 11. Mixed Native Faction Parties
print("[Test 11] Mixed Native Faction Party Balancing...")
local mixedAssigns, _ = balance.assign({
    { players = { player("m1", 0), player("m2", 1) } }, -- Party of 2 with 1 Alliance native and 1 Horde native
})
assert(mixedAssigns[1].team ~= mixedAssigns[2].team, "Mixed faction 2-man group alone in match splits 1v1")

print("  -> PASSED: Mixed native faction parties handled correctly.")

-- 12. Oscillating Alternating Favored Team Sequence
print("[Test 12] Oscillating Alternating Favored Team Sequence...")
local fav = nil
local curA, curH = 5, 5
local sequenceTeams = {}
for i = 1, 4 do
    local assigns, nextFav = balance.assign({ { players = { player("trickle" .. i, 0) } } }, curA, curH, fav)
    local assignedTeam = assigns[1].team
    table.insert(sequenceTeams, assignedTeam)
    if assignedTeam == 0 then curA = curA + 1 else curH = curH + 1 end
    fav = nextFav
end
assert(sequenceTeams[1] == 0 and sequenceTeams[2] == 1 and sequenceTeams[3] == 0 and sequenceTeams[4] == 1, "Trickle sequence alternates 0, 1, 0, 1")

print("  -> PASSED: Oscillating sequence alternates teams predictably.")

-- 13. Empty Queue & Single Player Bounds
print("[Test 13] Empty Queue & Single Player Bounds...")
local emptyAssigns, _ = balance.assign({})
assert(#emptyAssigns == 0, "Empty queue returns empty assignments")

local singleAssigns, _ = balance.assign({ { players = { player("lonely", 0) } } })
assert(#singleAssigns == 1, "Single player queue assigns correctly")

local emptyGroupAssigns, _ = balance.assign({ { players = {} } })
assert(#emptyGroupAssigns == 0, "An empty queue group returns no assignments")

print("  -> PASSED: Boundary cases (empty queue, single player) passed.")

-- 14. Extract Roster & Compute Map Bot Actions Helpers
print("[Test 14] Extract Roster & Compute Map Bot Actions Helpers...")
local mockMap = {
    GetPlayers = function()
        return {
            { GetBgTeamId = function() return 0 end, IsBot = function() return false end, GetClass = function() return 1 end },
            { GetBgTeamId = function() return 0 end, IsBot = function() return true end, GetClass = function() return 1 end, GetName = function() return "BotA1" end },
            { GetBgTeamId = function() return 1 end, IsBot = function() return true end, GetClass = function() return 8 end, GetName = function() return "BotH1" end },
        }
    end
}
local extracted = balance.extractRoster(mockMap)
assert(extracted[0].realCount == 1 and #extracted[0].bots == 1 and #extracted[1].bots == 1, "extractRoster parses real vs bot counts correctly")
assert(extracted[0].classCounts[1] == 1 and not extracted[1].classCounts[8], "extractRoster counts real-player classes only")

local function testStaleRosterExclusion()
    local stalePlayer = { guidLow = 1401, team = 0, class = 4, isBot = false }
    local filteredRoster = balance.extractRoster({ GetPlayers = function() return { stalePlayer } end }, { [1401] = true })
    assert(filteredRoster[0].realCount == 0, "Roster extraction must ignore a player whose leave event predates map removal")

    local staleSnapshotMap = {
        GetPlayers = function()
            return {
                stalePlayer,
                { guidLow = 1402, team = 1, class = 11, isBot = false },
            }
        end,
    }
    local staleExcludedRoster = balance.extractRoster(staleSnapshotMap, { [1401] = true })
    assert(staleExcludedRoster[0].realCount == 0 and staleExcludedRoster[1].realCount == 1,
        "A stale departing player must not remain in the active team roster")
    local staleExcludedBotPlan = balance.computeMapBotActions(staleSnapshotMap, 5, nil, { [1401] = true })
    assert(#staleExcludedBotPlan.toAdd[0] == 5 and #staleExcludedBotPlan.toAdd[1] == 4,
        "Bot replacement targets must be calculated from the filtered roster")
    local restoredRoster = balance.extractRoster(staleSnapshotMap)
    assert(restoredRoster[0].realCount == 1, "Roster extraction must stop excluding a player once no exclusion is supplied")
end
testStaleRosterExclusion()

;(function()
    local reenteredWarrior = {
        guidLow = 1420,
        team = 0,
        class = 1,
        isBot = true,
        name = "ReenteredWarrior",
    }
    local players = { reenteredWarrior }
    for i = 1, 6 do
        table.insert(players, { guidLow = 1500 + i, team = 0, class = i, isBot = false })
    end
    for i = 1, 7 do
        table.insert(players, { guidLow = 1600 + i, team = 1, class = i, isBot = false })
    end

    local reenteredMap = { GetPlayers = function() return players end }
    local staleReentryPlan = balance.computeMapBotActions(reenteredMap, 5, nil, { [1420] = true })
    assert(#staleReentryPlan.toAdd[0] == 1 and staleReentryPlan.toAdd[0][1] == 1,
        "A stale departed Warrior exclusion must reproduce the false duplicate-bot request")

    local activeReentryPlan = balance.computeMapBotActions(reenteredMap, 5)
    assert(#activeReentryPlan.toAdd[0] == 0 and #activeReentryPlan.toRemove == 0,
        "A re-entered Warrior present in the map must satisfy the trailing bot target")
end)()

local mapPlan = balance.computeMapBotActions(mockMap, 5)
assert(#mapPlan.toAdd[0] == 3 and #mapPlan.toAdd[1] == 4, "computeMapBotActions returns correct bot target additions")

;(function()
    local pendingPlan = balance.computeMapBotActions(
        { GetPlayers = function() return {
            { team = 0, class = 8, isBot = false },
        } end },
        5,
        nil,
        nil,
        { { name = "PendingA", teamId = 0, classId = 1 } }
    )
    assert(#pendingPlan.toAdd[0] == 3 and #pendingPlan.toAdd[1] == 5,
        "A pending bot reservation must count before the bot appears in the map snapshot")
end)()

print("  -> PASSED: Map roster extraction and map bot action calculation verified.")

-- 15. Empty Real Player BG Bot Kick Edge Case
print("[Test 15] Empty Real Player BG Bot Kick Edge Case...")
local bA0, bH0 = balance.calculateBotTargets(0, 0, 5)
assert(bA0 == 0 and bH0 == 0, "calculateBotTargets returns 0, 0 when 0 real players remain")

local emptyRealPlan = balance.computeBotActions({
    [0] = { realCount = 0, bots = { "botA1", "botA2", "botA3", "botA4" } },
    [1] = { realCount = 0, bots = { "botH1", "botH2", "botH3", "botH4", "botH5" } },
}, 5)
assert(#emptyRealPlan.toRemove == 9, "When last real player leaves (0 real players), all 9 remaining bots are kicked")
assert(#emptyRealPlan.toAdd[0] == 0 and #emptyRealPlan.toAdd[1] == 0, "No bots added when 0 real players remain")

print("  -> PASSED: All bots kicked when no real players remain in BG.")

-- 16. Bot Selection & Addition Class Priority
print("[Test 16] Bot Selection & Addition Class Priority...")

-- 16a: A team behind by one real player may receive the fixed Warrior first.
local teamNoWarrior = { { name = "RealPriest", class = 5 } }
local added1 = balance.selectClassesToAdd(teamNoWarrior, 1, nil, true)
assert(added1[1] == 1, "The team behind by one real player receives the Warrior first")

-- 16b: Equal teams do not receive the fixed Warrior automatically.
local teamRealWarrior = { { name = "RealWarrior", class = 1 } }
local addedRealWarrOne = balance.selectClassesToAdd(teamRealWarrior, 1, nil, false)
assert(addedRealWarrOne[1] == 11, "Equal teams must skip the fixed Warrior and pick Druid")
local addedRealWarr = balance.selectClassesToAdd(teamRealWarrior, 2, nil, false)
assert(addedRealWarr[1] == 11 and addedRealWarr[2] == 8,
    "Equal teams must use non-Warrior fillers")

-- 16c: 3-player premade (Warrior, Druid, Mage) -> Warrior first, then unrepresented Priest (5)
local teamTrio = {
    { name = "RealWarrior", class = 1 },
    { name = "RealDruid", class = 11 },
    { name = "RealMage", class = 8 },
}
local addedTrio = balance.selectClassesToAdd(teamTrio, 2, nil, true)
assert(addedTrio[1] == 1, "Warrior (1) remains the first filler")
assert(addedTrio[2] == 5, "Priest (5) is added second to complete unrepresented classes")

-- 16d: 2 real players (Priest, Rogue) -> Warrior (1) -> Druid (11) -> Mage (8)
local teamDuo = { { name = "RealPriest", class = 5 }, { name = "RealRogue", class = 4 } }
local addedDuo = balance.selectClassesToAdd(teamDuo, 3, nil, true)
assert(addedDuo[1] == 1, "Warrior (1) added first when missing")
assert(addedDuo[2] == 11, "Druid (11) added second")
assert(addedDuo[3] == 8, "Mage (8) added third")

-- 16e: Empty team 5-bot add -> Sequence MUST be Warrior(1) -> Druid(11) -> Mage(8) -> Priest(5) -> Rogue(4)
local emptyTeam = {}
local added5 = balance.selectClassesToAdd(emptyTeam, 5, nil, true)
assert(added5[1] == 1, "1st bot added to empty team is Warrior (1)")
assert(added5[2] == 11, "2nd bot added to empty team is Druid (11)")
assert(added5[3] == 8, "3rd bot added to empty team is Mage (8)")
assert(added5[4] == 5, "4th bot added to empty team is Priest (5)")
assert(added5[5] == 4, "5th bot added to empty team is Rogue (4)")

-- 16f: A bot class already in the BG is not selected again.
local addedWithWarriorBot = balance.selectClassesToAdd(emptyTeam, 1, { { class = 1 } }, true)
assert(addedWithWarriorBot[1] == 11, "Existing Warrior bot is skipped in favor of Druid")

local cappedClassAdd = balance.selectClassesToAdd({ { class = 1 }, { class = 1 } }, 1, nil, true)
assert(cappedClassAdd[1] ~= 1, "Bot filler must not add a third player of a class")

local botClassDoesNotCount = balance.selectClassesToAdd({ { class = 1 }, { class = 1, isBot = true } }, 1, nil, true)
assert(botClassDoesNotCount[1] == 1, "Bot classes must not consume the real-player class cap")

local equalTeamFillers = balance.computeBotActions({
    [0] = { realCount = 1, bots = {}, players = { { name = "alliancePriest", class = 5 } } },
    [1] = { realCount = 1, bots = {}, players = { { name = "hordePriest", class = 5 } } },
}, 3)
assert(equalTeamFillers.toAdd[0][1] ~= 1 and equalTeamFillers.toAdd[1][1] ~= 1,
    "Equal real-player teams must not receive the fixed Warrior bot")

local behindTeamWarrior = balance.computeBotActions({
    [0] = { realCount = 1, bots = {}, players = { { name = "alliancePriest", class = 5 } } },
    [1] = { realCount = 2, bots = {}, players = { { name = "hordePriest", class = 5 }, { name = "hordeMage", class = 8 } } },
}, 3)
assert(behindTeamWarrior.toAdd[0][1] == 1 and behindTeamWarrior.toAdd[1][1] ~= 1,
    "Only the team behind in real-player count may receive the fixed Warrior bot")

print("  -> PASSED: Bot addition selection sequence across diverse team compositions verified.")

-- 17. Bot Removal Class Priority & Order
print("[Test 17] Bot Removal Class Priority & Order...")

-- 17a: 5 unique class bots in team -> Full removal sequence must be Rogue(4) -> Priest(5) -> Mage(8) -> Druid(11) -> Warrior(1)
local unique5Bots = {
    { name = "BotWarr", class = 1 },
    { name = "BotDruid", class = 11 },
    { name = "BotMage", class = 8 },
    { name = "BotPriest", class = 5 },
    { name = "BotRogue", class = 4 },
}
local fullRemovalOrder = balance.sortBotsForRemoval(unique5Bots, unique5Bots)
assert(fullRemovalOrder[1].class == 4, "1st bot removed is Rogue (4)")
assert(fullRemovalOrder[2].class == 5, "2nd bot removed is Priest (5)")
assert(fullRemovalOrder[3].class == 8, "3rd bot removed is Mage (8)")
assert(fullRemovalOrder[4].class == 11, "4th bot removed is Druid (11)")
assert(fullRemovalOrder[5].class == 1, "5th bot removed is Warrior (1)")

-- 17b: Real Priest joins {Warrior, Druid, Mage, Priest, Rogue} -> Duplicated Priest bot leaves
local teamPlusRealPriest = {
    { name = "BotWarr", class = 1 },
    { name = "BotDruid", class = 11 },
    { name = "BotMage", class = 8 },
    { name = "BotPriest", class = 5 },
    { name = "BotRogue", class = 4 },
    { name = "RealPriest", class = 5 }, -- Real player joining
}
local removeForRealPriest = balance.sortBotsForRemoval(unique5Bots, teamPlusRealPriest)
assert(removeForRealPriest[1].class == 5, "Duplicated Priest (5) bot leaves when real Priest joins")

-- 17c: Real Warrior joins {Warrior, Druid, Mage, Priest, Rogue} -> Duplicated Warrior bot leaves
local teamPlusRealWarr = {
    { name = "BotWarr", class = 1 },
    { name = "BotDruid", class = 11 },
    { name = "BotMage", class = 8 },
    { name = "BotPriest", class = 5 },
    { name = "BotRogue", class = 4 },
    { name = "RealWarrior", class = 1 }, -- Real player joining
}
local removeForRealWarr = balance.sortBotsForRemoval(unique5Bots, teamPlusRealWarr)
assert(removeForRealWarr[1].class == 1, "Duplicated Warrior (1) bot leaves when real Warrior joins")

-- 17d: Duplicated class removal priority (2 Rogues, 2 Warriors, 1 Druid)
local duplicatedTeam = {
    { name = "BotWarr1", class = 1 },
    { name = "BotWarr2", class = 1 },
    { name = "BotRogue1", class = 4 },
    { name = "BotRogue2", class = 4 },
    { name = "BotDruid", class = 11 },
}
local dupRemovalOrder = balance.sortBotsForRemoval(duplicatedTeam, duplicatedTeam)
assert(dupRemovalOrder[1].class == 4, "Duplicated Rogue (4) is removed before duplicated Warrior (1) or single Druid (11)")
assert(dupRemovalOrder[#dupRemovalOrder].class == 11, "Single Druid (11) is preserved over duplicated classes")

-- 17e: A flag-carrying bot is protected, then swapped for the trailing Warrior after dropping the flag.
do
    local flagMage = { name = "FlagMage", class = 8, isBot = true, isFlagCarrier = true }
    local carrierOrder = balance.sortBotsForRemoval({ flagMage, { name = "BotRogue", class = 4, isBot = true } }, { flagMage })
    assert(carrierOrder[#carrierOrder] == flagMage, "Flag carrier must be last in bot removal order")

local carryingPlan = balance.computeBotActions({
        [0] = { realCount = 9, bots = { flagMage }, players = { flagMage } },
        [1] = { realCount = 10, bots = {}, players = {} },
    }, 5)
    assert(#carryingPlan.toRemove == 0 and #carryingPlan.toAdd[0] == 0,
        "A flag-carrying bot must not be kicked while it is carrying the flag")
    assert(#carryingPlan.blockedRemovals == 1 and carryingPlan.blockedRemovals[1].reason == "flag_carrier",
        "Blocked flag-carrier removals must expose their reason for diagnostics")

    flagMage.isFlagCarrier = false
    local droppedFlagPlan = balance.computeBotActions({
        [0] = { realCount = 9, bots = { flagMage }, players = { flagMage } },
        [1] = { realCount = 10, bots = {}, players = {} },
    }, 5)
    assert(#droppedFlagPlan.toRemove == 1 and droppedFlagPlan.toRemove[1] == flagMage
        and #droppedFlagPlan.toAdd[0] == 1 and droppedFlagPlan.toAdd[0][1] == 1,
        "After the flag is dropped, the carrier is replaced by the trailing Warrior bot")
end

print("  -> PASSED: Bot removal order across diverse real player join scenarios verified.")

-- 18. Randomized feasible class-cap stress matrix
print("[Test 18] Randomized feasible class-cap stress matrix...")
local stressClasses = { 1, 2, 3, 4, 5 }
for seed = 201, 300 do
    math.randomseed(seed)
    local totalPlayers = math.random(1, 20)
    local groups = {}
    local remaining = totalPlayers
    local playerId = 1
    while remaining > 0 do
        local groupSize = math.min(remaining, math.random(1, 5))
        local groupPlayers = {}
        for _ = 1, groupSize do
            local classId = stressClasses[((playerId - 1) % #stressClasses) + 1]
            table.insert(groupPlayers, player("stress" .. playerId, math.random(0, 1), classId))
            playerId = playerId + 1
        end
        table.insert(groups, { players = groupPlayers })
        remaining = remaining - groupSize
    end
    local _, counts = run(groups)
    assert(math.abs(counts[0] - counts[1]) <= 1, "Random stress setup violated the team-size rule")
end
print("  -> PASSED: 100 feasible randomized class compositions respected both hard rules.")

-- 19. Same-class group boundaries and mixed unknown classes
print("[Test 19] Same-class group boundaries and unknown class compatibility...")
local fourWarriorGroup = { players = {} }
for i = 1, 4 do table.insert(fourWarriorGroup.players, player("fourWarr" .. i, 0, 1)) end
local fourWarriorTeams, fourWarriorCounts = run({ fourWarriorGroup })
assert(fourWarriorCounts[0] == 2 and fourWarriorCounts[1] == 2, "Four same-class players must split exactly 2v2")
assert(fourWarriorTeams.fourWarr1 ~= fourWarriorTeams.fourWarr2
    or fourWarriorTeams.fourWarr2 ~= fourWarriorTeams.fourWarr3,
    "Four same-class players must not remain on one team")

local fiveWarriorGroup = { players = {} }
for i = 1, 5 do table.insert(fiveWarriorGroup.players, player("fiveWarr" .. i, 0, 1)) end
assert(#balance.assign({ fiveWarriorGroup }) == 0, "Five same-class players have no valid 2-per-team assignment")

local mixedUnknownTeams, mixedUnknownCounts = run({
    { players = {
        player("known1", 0, 1),
        player("known2", 0, 1),
        player("known3", 0, 1),
        player("known4", 0, 1),
        player("unknown", 1),
    } },
})
assert(mixedUnknownCounts[0] + mixedUnknownCounts[1] == 5, "Unknown class data must not drop an otherwise assignable player")
assert(mixedUnknownTeams.unknown == 0 or mixedUnknownTeams.unknown == 1, "Unknown class player receives a normal team assignment")
print("  -> PASSED: Same-class boundaries and unknown class data behave safely.")

-- 20. Active-BG group splitting and exact cap boundary
print("[Test 20] Active-BG group splitting at the exact class-cap boundary...")
local splitAtCapTeams, splitAtCapCounts = runWithCurrentRoster(
    { { players = { player("splitWarr1", 0, 1), player("splitWarr2", 0, 1) } } },
    1,
    1,
    0,
    { [0] = { [1] = 1 }, [1] = {} }
)
assert(splitAtCapCounts[0] == 2 and splitAtCapCounts[1] == 2, "Cap-aware active-BG split must remain 2v2")
assert(splitAtCapTeams.splitWarr1 ~= splitAtCapTeams.splitWarr2, "Two-player class group must split when team balance requires it")

local exactCapTeams = runWithCurrentRoster(
    { { players = { player("secondWarr", 0, 1) } } },
    2,
    2,
    0,
    { [0] = { [1] = 1 }, [1] = {} }
)
assert(exactCapTeams.secondWarr == 1, "Class priority should use the other team when it avoids a class imbalance")
print("  -> PASSED: Active-BG cap boundary and split behavior verified.")

-- 21. Social-group aggregation must preserve class data before assignment.
print("[Test 21] Social-group aggregation with class-aware assignment...")
local socialGroup = { GetGUID = function() return 91021 end }
local socialPlayers = {}
for i, classId in ipairs({ 1, 1, 11, 11 }) do
    table.insert(socialPlayers, {
        GetGroup = function() return socialGroup end,
        GetGUID = function() return 91021 + i end,
        GetTeam = function() return i <= 2 and 0 or 1 end,
        GetClass = function() return classId end,
    })
end
local socialGrouped = balance.groupQueuedPlayers(socialPlayers)
assert(#socialGrouped == 1 and #socialGrouped[1].players == 4, "Social group members must remain one assignment group")
assert(socialGrouped[1].players[1].classId == 1 and socialGrouped[1].players[3].classId == 11,
    "Social-group aggregation must preserve every member's class")
local _, socialCounts = run(socialGrouped)
assert(socialCounts[0] == 2 and socialCounts[1] == 2, "Class-aware social group must remain balanced")
print("  -> PASSED: Social-group aggregation preserves classes and balance.")

-- 22. One large 20-player group with four of each class.
print("[Test 22] 20-player class-complete premade...")
local twentyPlayerGroup = { players = {} }
for i = 1, 20 do
    local classId = stressClasses[((i - 1) % #stressClasses) + 1]
    table.insert(twentyPlayerGroup.players, player("twenty" .. i, i % 2, classId))
end
local _, twentyCounts = run({ twentyPlayerGroup })
assert(twentyCounts[0] == 10 and twentyCounts[1] == 10, "20-player premade must split 10v10 under class caps")
print("  -> PASSED: 20-player class-complete premade respects both hard rules.")

-- 23. WSG player-cap boundaries.
print("[Test 23] WSG 10v10 player-cap boundaries...")
local overCapacityAssignments = balance.assign(
    { { players = { player("overCapacity", 0) } } },
    10,
    10
)
assert(#overCapacityAssignments == 0, "A full team must not receive another player")

local twentyOnePlayers = {}
for i = 1, 21 do
    table.insert(twentyOnePlayers, player("cap" .. i, i % 2))
end
local selectedTwenty, excludedTwenty = balance.selectQueuedPlayers(twentyOnePlayers)
assert(#selectedTwenty == 20 and #excludedTwenty == 1, "Fresh WSG selection must stop at 20 total players")
local _, cappedCounts = run(balance.groupQueuedPlayers(selectedTwenty))
assert(cappedCounts[0] <= 10 and cappedCounts[1] <= 10, "Assignments must never exceed 10 players per team")
print("  -> PASSED: WSG assignments respect the 10v10 limit.")

-- 24. Queue controller state includes pending invites in both caps.
print("[Test 24] Queue controller tracks pending invites in capacity and class counts...")
local queueController = balance.createQueueController()
local hunterOne = { guidLow = 2401, class = 3 }
local hunterTwo = { guidLow = 2402, class = 3 }
local hunterThree = { guidLow = 2403, class = 3 }
queueController:setPendingInvite(hunterOne, 9001, 0)
queueController:setPendingInvite(hunterTwo, 9001, 0)

local pendingClassCounts = queueController:getClassCounts(9001, {
    [0] = { classCounts = { [3] = 1 } },
    [1] = { classCounts = {} },
})
assert(pendingClassCounts[0][3] == 3, "Pending invites must count toward the active team class cap")

local pendingTeamCounts = queueController:getTeamCountsWithPending(9001, { [0] = 8, [1] = 2 }, {})
assert(pendingTeamCounts[0] == 10 and pendingTeamCounts[1] == 2, "Pending invites must count toward the 10-player team cap")

queueController:setPendingInvite(hunterThree, 9001, 0)
local overfullTeamCounts = queueController:getTeamCountsWithPending(9001, { [0] = 8, [1] = 2 }, {})
assert(overfullTeamCounts[0] == 11, "A third pending invite must remain visible to the capacity selector")
local activePlan, activeExcluded = queueController:planActiveInvites(
    { { name = "hunter4", nativeTeam = 1, classId = 3, guidLow = 2404 } },
    {
        [0] = { realCount = 1, classCounts = { [3] = 1 }, players = {}, bots = {} },
        [1] = { realCount = 2, classCounts = { [3] = 2 }, players = {}, bots = {} },
    },
    9001,
    { [0] = 3, [1] = 2 },
    10
)
assert(activePlan == nil and #activeExcluded == 1, "Active matchmaking must defer a class once pending invites fill its cap")

do
    local botDoesNotConsumeCapacity = balance.createQueueController()
    local latePlayer = { name = "late-player", nativeTeam = 0, classId = 8, guidLow = 2410 }
    local latePlan = botDoesNotConsumeCapacity:planActiveInvites(
        { latePlayer },
        {
            [0] = { realCount = 9, classCounts = {}, players = {}, bots = { { isBot = true } } },
            [1] = { realCount = 9, classCounts = {}, players = {}, bots = {} },
        },
        9002,
        { [0] = 9, [1] = 9 },
        10
    )
    assert(latePlan and latePlan.fits, "A bot occupying the tenth map slot must not block a real player join")
end
queueController:clearPlayer(hunterTwo.guidLow)
assert(queueController:getPendingInvite(hunterTwo.guidLow) == nil, "Clearing a player must retract its pending invite")
assert(queueController:getClassCounts(9001, {
    [0] = { classCounts = { [3] = 1 } },
    [1] = { classCounts = {} },
})[0][3] == 3, "Remaining pending invites must stay counted after one player leaves")
print("  -> PASSED: Queue controller keeps pending class and player caps consistent.")

-- 25. Queue controller invite and active-instance lifecycle transitions.
print("[Test 25] Queue controller lifecycle transitions clear and replace state correctly...")
local lifecycleController = balance.createQueueController()
local lifecyclePlayer = { guidLow = 2501, class = 8 }
lifecycleController:markClassCapWarning(lifecyclePlayer.guidLow)
lifecycleController:markGroupSplitWarning(lifecyclePlayer.guidLow)
lifecycleController:setRetryAt(lifecyclePlayer.guidLow, 12345)
lifecycleController:setPendingInvite(lifecyclePlayer, true)
assert(lifecycleController:hasPendingInvite(9901), "Fresh-match reservations must remain visible for any pending BG")

lifecycleController:recordAcceptedInvite(lifecyclePlayer, 9901, 1)
local acceptedInvite = lifecycleController:getPendingInvite(lifecyclePlayer.guidLow)
assert(acceptedInvite.instanceId == 9901 and acceptedInvite.teamId == 1 and acceptedInvite.classId == 8,
    "Accepted invites must replace the fresh reservation with instance, team, and class data")
assert(not lifecycleController:hasClassCapWarning(lifecyclePlayer.guidLow)
    and not lifecycleController:hasGroupSplitWarning(lifecyclePlayer.guidLow)
    and lifecycleController:getRetryAt(lifecyclePlayer.guidLow) == nil,
    "Accepting an invite must clear stale queue warnings and retry state")

lifecycleController:clearPendingInvite(lifecyclePlayer.guidLow)
assert(not lifecycleController:hasPendingInvite(9901), "Clearing an invite must remove it from active-BG accounting")
lifecycleController:setRetryAt(lifecyclePlayer.guidLow, 456)
lifecycleController:markClassCapWarning(lifecyclePlayer.guidLow)
lifecycleController:clearPlayer(lifecyclePlayer.guidLow)
assert(lifecycleController:getRetryAt(lifecyclePlayer.guidLow) == nil
    and not lifecycleController:hasClassCapWarning(lifecyclePlayer.guidLow),
    "Clearing a player must remove all queue bookkeeping, not only the invite")

lifecycleController:markPlayerLeft(9905, lifecyclePlayer)
assert(lifecycleController:getDepartedPlayers(9905)[lifecyclePlayer.guidLow] == true,
    "A BG leave must remember the player until the stale map snapshot is gone")
lifecycleController:markPlayerEntered(9905, lifecyclePlayer)
assert(lifecycleController:getDepartedPlayers(9905)[lifecyclePlayer.guidLow] == nil,
    "A BG re-entry must restore the player to active roster consideration")
lifecycleController:clearDepartedPlayers(9905)
assert(next(lifecycleController:getDepartedPlayers(9905)) == nil,
    "Departed-player exclusions must be clearable when the BG instance ends")

local fakeBG = { GetInstanceId = function() return 9902 end }
lifecycleController:trackActiveBG(fakeBG)
lifecycleController:trackActiveInstance(9903)
assert(lifecycleController:getActiveBGInstances()[9902] == fakeBG
    and lifecycleController:getActiveBGInstances()[9903] == true,
    "Active BG tracking must retain both object-backed and instance-only entries")
lifecycleController:untrackActiveBG(9902)
lifecycleController:untrackActiveBG(9903)
assert(next(lifecycleController:getActiveBGInstances()) == nil, "Ended BG instances must be removed from controller state")
print("  -> PASSED: Queue controller lifecycle transitions are isolated and complete.")

-- 26. Fresh-match plans expose selection and reservation effects without ALE objects.
print("[Test 26] Fresh-match controller plans are deterministic at queue boundaries...")
local freshController = balance.createQueueController()
local freshPlayers = {}
for i = 1, 21 do
    table.insert(freshPlayers, { name = "fresh" .. i, nativeTeam = i % 2, classId = i <= 5 and 8 or 0, guidLow = 2600 + i })
end
local freshPlan = freshController:planFreshMatch(freshPlayers)
assert(#freshPlan.selectedPlayers == 20 and #freshPlan.excludedPlayers == 1,
    "Fresh-match plans must enforce the 20-player queue boundary")
assert(#freshPlan.assignments == 20 and freshPlan.summary.teamCounts[0] <= 10 and freshPlan.summary.teamCounts[1] <= 10,
    "Fresh-match plans must return a complete 10v10-safe assignment")
freshController:reserveFreshInvites(freshPlan.selectedPlayers)
for _, queuedPlayer in ipairs(freshPlan.selectedPlayers) do
    assert(freshController:getPendingInvite(queuedPlayer.guidLow) ~= nil,
        "Fresh-match reservation must create one pending record per selected player")
end
print("  -> PASSED: Fresh-match plans expose tested selection and reservation behavior.")

-- 27. Active-match plans respect the exact player-cap boundary after balancing.
print("[Test 27] Active-match plan capacity is checked after team assignment...")
local activeBoundaryController = balance.createQueueController()
local boundaryQueue = {
    { name = "boundary1", nativeTeam = 1, classId = 0 },
}
local boundaryRoster = {
    [0] = { realCount = 9, classCounts = {}, players = {}, bots = {} },
    [1] = { realCount = 10, classCounts = {}, players = {}, bots = {} },
}
local boundaryPlan = activeBoundaryController:planActiveInvites(
    boundaryQueue,
    boundaryRoster,
    9904,
    { [0] = 10, [1] = 10 },
    10
)
assert(boundaryPlan and not boundaryPlan.fits and boundaryPlan.reason == "player_capacity",
    "Active-match plans must reject assignments that would exceed 10 players per team")
assert(boundaryPlan.teamCounts[0] > 10 or boundaryPlan.teamCounts[1] > 10,
    "Capacity rejection must expose the projected team counts")
print("  -> PASSED: Active-match plans enforce the exact 10v10 boundary after assignment.")

-- 28. Active assignments include pending invites when the map is still WAIT_JOIN.
print("[Test 28] Active-match team balance includes pending invite teams...")
local function testPendingTeamBalance()
    local pendingController = balance.createQueueController()
    pendingController:setPendingInvite({ guidLow = 2801, class = 8 }, 9905, 0)
    pendingController:setPendingInvite({ guidLow = 2802, class = 2 }, 9905, 0)
    pendingController:setPendingInvite({ guidLow = 2803, class = 4 }, 9905, 1)

    local pendingPlan = pendingController:planActiveInvites(
        { { name = "nextPlayer", nativeTeam = 0, classId = 5 } },
        {
            [0] = { realCount = 0, classCounts = {}, players = {}, bots = {} },
            [1] = { realCount = 0, classCounts = {}, players = {}, bots = {} },
        },
        9905,
        { [0] = 0, [1] = 0 },
        10
    )
    assert(pendingPlan and #pendingPlan.assignments == 1 and pendingPlan.assignments[1].team == 1,
        "A player joining a 2A versus 1H pending match must be assigned to Horde")
end
testPendingTeamBalance()
print("  -> PASSED: Pending invites participate in active team balancing before map entry.")

-- 29. Native queue distribution boundary rejects values that can crash or
-- misparse in the ALE C++ decimal std::stoull conversion.
print("[Test 29] Native queue distribution GUID boundary rejects unsafe values...")
assert(balance.nativeDistributionGuidKey(28001) == "28001", "Small integer GUIDs remain supported as decimal strings")
assert(balance.nativeDistributionGuidKey("28001") == "28001", "Canonical decimal GUID strings remain supported")
assert(balance.nativeDistributionGuidKey("00028001") == "28001", "Leading zeroes are canonicalized before native parsing")
assert(balance.nativeDistributionGuidKey("08") == "8", "Octal-looking decimal strings are canonicalized")
assert(balance.nativeDistributionGuidKey("18446744073709551615") == "18446744073709551615", "Maximum uint64 GUID is supported")
assert(balance.nativeDistributionGuidKey("18446744073709551616") == nil, "uint64 overflow is rejected")
assert(balance.nativeDistributionGuidKey("Player-1-28001") == nil, "Formatted GUID strings are rejected")
assert(balance.nativeDistributionGuidKey(9007199254740992) == nil, "Unsafe Lua integers are rejected")
assert(balance.nativeDistributionTeamId(0) == 0 and balance.nativeDistributionTeamId(1) == 1,
    "Only Alliance and Horde team IDs are supported")
assert(balance.nativeDistributionTeamId(2) == nil and balance.nativeDistributionTeamId("0") == nil,
    "Invalid native team IDs are rejected")
print("  -> PASSED: Native distribution inputs are range-checked and fail closed.")

-- 30. Shared match state keeps participants and end-reward delivery in sync.
function testSharedMatchState()
    print("[Test 30] Shared WSG match state retains participants who leave and claims rewards once...")
    local state = require("wsg-state")
    local matchState = state.create()
    local matchController = balance.createQueueController(matchState)
    local matchPlayer = {
        guidLow = 3001,
        guid = "Player-3001",
        name = "leaver",
        class = 4,
        team = 0,
        bgTeam = 1,
    }
    matchController:markPlayerLeft(9930, matchPlayer)
    matchController:markPlayerEntered(9930, matchPlayer)

    local participants = state.getParticipants(matchState, 9930)
    assert(participants["3001"] and participants["3001"].guid == "Player-3001"
        and participants["3001"].team == 1,
        "Rewards must use the participant's battleground team, not permanent faction")

    local arenaState = state.create()
    state.recordParticipant(arenaState, 9931, {
        guidLow = 3010,
        guid = "Player-3010",
        name = "arena-player",
        bgTeam = 0,
    }, 1)
    assert(state.getParticipants(arenaState, 9931)["3010"].team == 1,
        "Arena rewards must retain the arena team instead of the permanent faction")

    local previousGetPlayerByGUID = _G.GetPlayerByGUID
    local livePlayer = { isBot = false }
    local liveBot = { isBot = true }
    _G.GetPlayerByGUID = function(guid)
        return ({ ["Player-3001"] = livePlayer, ["Player-3002"] = liveBot })[guid]
    end
    matchState.participants[9930]["3002"] = {
        guid = "Player-3002",
        guidLow = 3002,
        team = 0,
        name = "bot",
    }
    local previousGetPlayersInWorld = _G.GetPlayersInWorld
    local restoredPlayer = {
        isBot = false,
        InBattleground = function() return true end,
        GetBattlegroundTypeId = function() return 2 end,
        GetMapId = function() return 489 end,
        GetBattlegroundId = function() return 9932 end,
        guidLow = 3005,
        guid = "Player-3005",
        name = "restored",
        bgTeam = 0,
    }
    local ignoredPlayer = {
        isBot = false,
        InBattleground = function() return true end,
        GetBattlegroundTypeId = function() return 2 end,
        GetMapId = function() return 1 end,
        GetBattlegroundId = function() return 9933 end,
        guidLow = 3006,
        guid = "Player-3006",
        name = "ignored",
        bgTeam = 1,
    }
    _G.GetPlayersInWorld = function() return { restoredPlayer, ignoredPlayer } end
    local restored = state.restoreFromWorld(matchState, 2, 489)
    _G.GetPlayersInWorld = previousGetPlayersInWorld
    assert(restored[9932] and not restored[9933]
        and state.getParticipants(matchState, 9932)["3005"],
        "World restoration must record real WSG players and return their active instances")
    matchState.activeBGInstances[9932] = true
    local previousGetPlayerByGUIDAfterRestore = _G.GetPlayerByGUID
    _G.GetPlayerByGUID = function(guid)
        return guid == "Player-3005" and restoredPlayer or nil
    end
    local activeBattlegroundCount = 0
    local activePlayerCount = 0
    state.forEachActiveBattlegrounds(matchState, function(instanceId, players)
        activeBattlegroundCount = activeBattlegroundCount + 1
        assert(instanceId == 9932, "Active battleground iteration must return the tracked instance")
        for _, player in ipairs(players) do
            activePlayerCount = activePlayerCount + 1
            assert(player == restoredPlayer,
                "Active battleground iteration must return synchronized players")
        end
    end)
    _G.GetPlayerByGUID = previousGetPlayerByGUIDAfterRestore
    assert(activeBattlegroundCount == 1 and activePlayerCount == 1,
        "Active battleground iteration must group synchronized players by instance")

    local callbackCount = 0
    local callbackTeam
    local unavailableCount = 0
    local iterated = state.forEachPlayers(matchState, 9930, function(player, participant)
        callbackCount = callbackCount + 1
        callbackTeam = participant.team
        assert(player == livePlayer, "Player iteration must expose the live non-bot player")
    end, function()
        unavailableCount = unavailableCount + 1
    end)
    _G.GetPlayerByGUID = previousGetPlayerByGUID
    assert(iterated == 1 and callbackCount == 1 and callbackTeam == 1 and unavailableCount == 0,
        "Player iteration must exclude bots while preserving participant metadata")

    assert(state.claimEndRewards(matchState, 9930), "The first end-reward delivery must claim the match")
    assert(not state.claimEndRewards(matchState, 9930), "The same match must not distribute end rewards twice")
    state.clearMatch(matchState, 9930)
    assert(next(state.getParticipants(matchState, 9930)) == nil,
        "Clearing a match must remove its participant records")
    print("  -> PASSED: Shared match state preserves participants and enforces one end-reward claim.")
end
testSharedMatchState()
testSharedMatchState = nil

print("\nwsg_balance_test: ok (All 30 test suites passed cleanly)")
