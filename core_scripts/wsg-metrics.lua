print("[WSG Metrics] Loading wsg-metrics.lua script...")

-- Global storage for active match statistics partitioned by instanceId
-- instanceId -> (playerGuidString -> statsTable)
local matchStats = {}
-- auraObject -> { caster = guidString, type = "HARD"|"SOFT", startTime = ms }
local activeCCs = {}
-- playerGuidString -> flagCarryStartTime
local flagCarryStartTimes = {}
-- instanceId -> matchStartTime
local matchStartTimes = {}
local WSG_MAP_ID = 489
local WSG_BG_TYPE_ID = 2

-- 1. Dispel / Protective Spells definition (filtered to level 19 starting spells)
local DISPEL_PROTECTIVE_SPELLS = {
    -- Priest
    [527] = true,   -- Dispel Magic
    [528] = true,   -- Cure Disease
    -- Paladin
    [1152] = true,  -- Purify
    [1022] = true,  -- Hand of Protection
    [1044] = true,  -- Hand of Freedom
    -- Shaman
    [370] = true,   -- Purge
    [526] = true,   -- Cure Toxins
    -- Mage
    [475] = true,   -- Remove Curse
    -- Druid
    [8946] = true,  -- Cure Poison
}

-- 2. Shield / Absorb Spells definition (filtered to level 19 starting spells)
local SHIELD_SPELLS = {
    [17] = 150,     -- Power Word: Shield (Rank 1)
    [592] = 220,    -- Power Word: Shield (Rank 2)
    [600] = 300,    -- Power Word: Shield (Rank 3)
}

-- 3. Crowd Control Spell IDs definition (filtered to level 19 starting spells & ranks)
local CC_SPELLS = {
    -- Hard CC (Loss of Control)
    [118] = "HARD",    -- Polymorph
    [5782] = "HARD",   -- Fear
    [8122] = "HARD",   -- Psychic Scream
    [853] = "HARD",    -- Hammer of Justice (Rank 1)
    [10308] = "HARD",  -- Hammer of Justice (Rank 2)
    [1776] = "HARD",   -- Gouge
    [6770] = "HARD",   -- Sap (Rank 1)
    [2070] = "HARD",   -- Sap (Rank 2)
    [5211] = "HARD",   -- Bash
    [2637] = "HARD",   -- Hibernate
    [1513] = "HARD",   -- Scare Beast
    [100] = "HARD",    -- Charge Stun

    -- Soft CC (Snare & Roots)
    [339] = "SOFT",    -- Entangling Roots
    [122] = "SOFT",    -- Frost Nova (Rank 1)
    [865] = "SOFT",    -- Frost Nova (Rank 2)
    [116] = "SOFT",    -- Frostbolt (Rank 1 slow)
    [20572] = "SOFT",  -- Frostbolt (Rank 2 slow)
    [20573] = "SOFT",  -- Frostbolt (Rank 3 slow)
    [1715] = "SOFT",   -- Hamstring (Rank 1)
    [7373] = "SOFT",   -- Hamstring (Rank 2)
    [5116] = "SOFT",   -- Concussive Shot
    [36006] = "SOFT",  -- Earthbind Totem Slow
}

-- Helper to get/initialize stats for a player, partitioned by instanceId
local function GetStats(player, instanceId)
    if player:IsBot() then return nil end

    if not instanceId or instanceId == 0 then
        instanceId = player:GetBattlegroundId()
    end
    if not instanceId or instanceId == 0 then return nil end

    if not matchStats[instanceId] then
        matchStats[instanceId] = {}
    end

    -- Set match start time if not already initialized
    if not matchStartTimes[instanceId] then
        matchStartTimes[instanceId] = GetCurrTime()
    end

    local guid = tostring(player:GetGUID())
    if not matchStats[instanceId][guid] then
        matchStats[instanceId][guid] = {
            name = player:GetName(),
            playerGuid = guid,
            dispelsOffensive = 0,
            dispelsDefensive = 0,
            hardCCCount = 0,
            hardCCDuration = 0,
            softCCCount = 0,
            softCCDuration = 0,
            healsDone = 0,
            absorbsDone = 0,
            healsOnFC = 0,
            flagCarryTime = 0,
            damageOnEFC = 0,
            damageTaken = 0,
            killingBlows = 0,
            deaths = 0,
            honorableKills = 0,
            bonusHonor = 0,
            damageDone = 0,
            healingDone = 0,
            flagCaptures = 0,
            flagReturns = 0,
            deserted = false,
            joinTime = GetCurrTime(),
            timePlayed = 0,
        }
    end
    return matchStats[instanceId][guid]
end

-- Cache native battleground scores while Player userdata is still valid.
local function snapshotPlayerScore(player, instanceId)
    if player:IsBot() then return end

    local stats = GetStats(player, instanceId)
    if not stats then return end

    local bg = GetBattleground(instanceId, WSG_BG_TYPE_ID)
    if not bg then return end

    local score = bg:GetPlayerScore(player)
    if not score then return end

    stats.killingBlows = score.killingBlows or 0
    stats.deaths = score.deaths or 0
    stats.honorableKills = score.honorableKills or 0
    stats.bonusHonor = score.bonusHonor or 0
    stats.damageDone = score.damageDone or 0
    stats.healingDone = score.healingDone or 0
    stats.flagCaptures = score.flagCaptures or 0
    stats.flagReturns = score.flagReturns or 0
end

-- Score snapshots are intentionally numeric; no Player userdata is retained.
CreateLuaEvent(function()
    for _, player in ipairs(GetPlayersInWorld()) do
        if not player:IsBot() and player:InBattleground() and player:GetMapId() == WSG_MAP_ID then
            local instanceId = player:GetBattlegroundId()
            if instanceId then
                snapshotPlayerScore(player, instanceId)
            end
        end
    end
end, 500, 0)

-- Hook: Spell casting (for dispels / protective spells)
RegisterPlayerEvent(PLAYER_EVENT_ON_SPELL_CAST, function(event, player, spell, skipCheck)
    if player:IsBot() then return end

    if player:InBattleground() then
        local spellId = spell:GetEntry()
        if DISPEL_PROTECTIVE_SPELLS[spellId] then
            local target = spell:GetTarget()
            if target and target:ToPlayer() then
                local targetPlayer = target:ToPlayer()
                local stats = GetStats(player)
                if stats then
                    if player:GetTeam() == targetPlayer:GetTeam() then
                        stats.dispelsDefensive = stats.dispelsDefensive + 1
                    else
                        stats.dispelsOffensive = stats.dispelsOffensive + 1
                    end
                end
            end
        end
    end
end)

-- Hook: Aura application (for CC duration start, flag carrying, and shield absorbs)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_APPLY, function(event, player, aura)
    if player:InBattleground() then
        local caster = aura:GetCaster()
        if not caster then return end

        -- Resolve owner if the caster is a pet/totem/summon
        local casterPlayer = nil
        if caster:ToPlayer() then
            casterPlayer = caster:ToPlayer()
        elseif caster:GetOwner() and caster:GetOwner():ToPlayer() then
            casterPlayer = caster:GetOwner():ToPlayer()
        end
        if not casterPlayer or casterPlayer:IsBot() then return end

        local spellId = aura:GetAuraId()
        if not spellId then return end
        local ccType = CC_SPELLS[spellId]
        if ccType then
            activeCCs[aura] = {
                caster = tostring(casterPlayer:GetGUID()),
                type = ccType,
                startTime = GetCurrTime(),
            }
        end

        -- Flag carrying time tracking (only for real players)
        if (spellId == 23381 or spellId == 23382) and not player:IsBot() then
            flagCarryStartTimes[tostring(player:GetGUID())] = GetCurrTime()
        end

        -- Shield absorbs estimation
        local shield = SHIELD_SPELLS[spellId]
        if shield then
            local instanceId = casterPlayer:GetBattlegroundId()

            if shield.allowSelf or player:GetGUID() ~= casterPlayer:GetGUID() then
                -- Attributed to the caster
                local stats = GetStats(casterPlayer, instanceId)
                if stats then
                    stats.absorbsDone = stats.absorbsDone + shield.amount
                end

                -- Attributed to the target/victim
                if not player:IsBot() then
                    local targetStats = GetStats(player, instanceId)
                    if targetStats then
                        targetStats.damageTaken = targetStats.damageTaken + shield.amount
                    end
                end
            end
        end
    end
end)

-- Hook: Aura removal (for calculating CC duration and flag carrying elapsed time)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_REMOVE, function(event, player, aura, remove_mode)
    local entry = activeCCs[aura]
    if entry then
        local duration = GetCurrTime() - entry.startTime
        if duration > 0 then
            local instanceId = player:GetBattlegroundId()
            local stats = instanceId and matchStats[instanceId] and matchStats[instanceId][entry.caster]
            if stats then
                if entry.type == "HARD" then
                    stats.hardCCCount = stats.hardCCCount + 1
                    stats.hardCCDuration = stats.hardCCDuration + duration
                elseif entry.type == "SOFT" then
                    stats.softCCCount = stats.softCCCount + 1
                    stats.softCCDuration = stats.softCCDuration + duration
                end
            end
        end
        activeCCs[aura] = nil
    end

    local spellId = aura:GetAuraId()
    if spellId then
        if spellId == 23381 or spellId == 23382 then
            local guid = tostring(player:GetGUID())
            local startTime = flagCarryStartTimes[guid]
            if startTime then
                local elapsed = GetCurrTime() - startTime
                if elapsed > 0 and not player:IsBot() then
                    local stats = GetStats(player)
                    if stats then
                        stats.flagCarryTime = stats.flagCarryTime + elapsed
                    end
                end
                flagCarryStartTimes[guid] = nil
            end
        end
    end
end)

-- Hook: Heals done to other players (including heals on friendly flag carrier)
RegisterPlayerEvent(PLAYER_EVENT_ON_HEAL, function(event, player, target, heal)
    if player:IsBot() then return end

    if player:InBattleground() and target:ToPlayer() then
        local targetPlayer = target:ToPlayer()
        if player:GetGUID() ~= targetPlayer:GetGUID() then
            local stats = GetStats(player)
            if stats then
                stats.healsDone = stats.healsDone + heal

                -- If friendly target has either flag, track it as healing on friendly flag carrier
                if targetPlayer:HasAura(23381) or targetPlayer:HasAura(23382) then
                    stats.healsOnFC = stats.healsOnFC + heal
                end
            end
        end
    end
end)

-- Hook: Damage dealt & damage taken tracking
RegisterPlayerEvent(PLAYER_EVENT_ON_DAMAGE, function(event, player, target, damage)
    if player:InBattleground() and target:ToPlayer() then
        local targetPlayer = target:ToPlayer()

        -- Track damage taken by the victim (only if target is not a bot)
        if not targetPlayer:IsBot() then
            local victimStats = GetStats(targetPlayer)
            if victimStats then
                victimStats.damageTaken = victimStats.damageTaken + damage
            end
        end

        -- Track damage done specifically to EFC by the attacker (only if attacker is not a bot)
        if not player:IsBot() then
            if targetPlayer:HasAura(23381) or targetPlayer:HasAura(23382) then
                local stats = GetStats(player)
                if stats then
                    stats.damageOnEFC = stats.damageOnEFC + damage
                end
            end
        end
    end
end)

-- Hook: Track player desertion and total play time when leaving
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    if player:IsBot() then return end

    local stats = GetStats(player, instanceId)
    if not stats then return end
    -- Record play time up to the point they left
    stats.timePlayed = GetCurrTime() - stats.joinTime
    if not bg then return end
    local status = bg:GetStatus()
    if status >= 4 then return end -- STATUS_WAIT_LEAVE is 4
    -- Store the exact second of the match when they deserted
    local matchStart = matchStartTimes[instanceId] or stats.joinTime
    stats.deserted = math.floor((GetCurrTime() - matchStart) / 1000)
end)

-- Hook: Send aggregated stats as web event at the end of the BG match
RegisterBGEvent(BG_EVENT_ON_END, function(event, bg, bgId, instanceId, winner)
    local currentMatchStats = matchStats[instanceId]
    if not currentMatchStats then return end

    -- Format flag carrying time (convert ms to seconds) and CC duration
    for guid, stats in pairs(currentMatchStats) do
        stats.flagCarryTime = math.floor(stats.flagCarryTime / 1000)
        stats.hardCCDuration = math.floor(stats.hardCCDuration / 1000)
        stats.softCCDuration = math.floor(stats.softCCDuration / 1000)

        -- If they stayed until the end of the match, compute their final timePlayed
        if stats.timePlayed == 0 then
            stats.timePlayed = GetCurrTime() - stats.joinTime
        end
        stats.timePlayed = math.floor(stats.timePlayed / 1000)

        -- Clean up internal helper fields before sending
        stats.joinTime = nil

    end

    print("[WSG Metrics] Closing match instance " .. instanceId .. ". Sending PVP_BG_STATS web event...")
    SendWebEvent('PVP_BG_STATS', nil, {
        instanceId = instanceId,
        winner = winner,
        players = currentMatchStats,
    })

    -- Clear stats only for this specific match instance
    matchStats[instanceId] = nil
    matchStartTimes[instanceId] = nil
end)
