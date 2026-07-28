print("[WSG Metrics] Loading wsg-metrics.lua script...")

-- Global storage for active match statistics partitioned by instanceId
-- instanceId -> (playerGuidString -> statsTable)
local matchStats = {}
-- aura pointer string -> { caster = guidString, type = "HARD"|"SOFT", startTime = ms }
local activeCCs = {}
-- aura pointer string -> { caster = guidString, instanceId, effectIndex, initialAmount }
local activeAbsorbs = {}
-- playerGuidString -> flagCarryStartTime
local flagCarryStartTimes = {}
-- instanceId -> matchStartTime
local matchStartTimes = {}
local WSG_MAP_ID = 489
local WSG_BG_TYPE_ID = 2
local PREPARATION_AURA = 44521
local HORDE_FLAG = 23333
local ALLIANCE_FLAG = 23335
local WSG_FLAG_AURAS = {
    [HORDE_FLAG] = "HORDE",
    [ALLIANCE_FLAG] = "ALLIANCE",
}

local function isFlagCarrier(player)
    return player:HasAura(HORDE_FLAG) or player:HasAura(ALLIANCE_FLAG)
end

local function isMatchStarted(player)
    return not player:HasAura(PREPARATION_AURA)
end

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

-- 2. Damage-absorb aura effect type
local SPELL_AURA_SCHOOL_ABSORB = 69

-- 3. Crowd control mechanics
-- These values are the core Mechanics enum values. SpellInfo exposes them as
-- a bit mask, so every rank and every player spell is handled automatically.
local MECHANIC_CHARM = 1
local MECHANIC_DISORIENTED = 2
local MECHANIC_DISARM = 3
local MECHANIC_DISTRACT = 4
local MECHANIC_FEAR = 5
local MECHANIC_GRIP = 6
local MECHANIC_SILENCE = 9
local MECHANIC_SLEEP = 10
local MECHANIC_STUN = 12
local MECHANIC_FREEZE = 13
local MECHANIC_KNOCKOUT = 14
local MECHANIC_POLYMORPH = 17
local MECHANIC_BANISH = 18
local MECHANIC_SHACKLE = 20
local MECHANIC_HORROR = 24
local MECHANIC_SAPPED = 30
local MECHANIC_ROOT = 7
local MECHANIC_SLOW_ATTACK = 8
local MECHANIC_SNARE = 11
local MECHANIC_BLEED = 15
local MECHANIC_BANDAGE = 16
local MECHANIC_SHIELD = 19
local MECHANIC_MOUNT = 21
local MECHANIC_INFECTED = 22
local MECHANIC_TURN = 23
local MECHANIC_INVULNERABILITY = 25
local MECHANIC_INTERRUPT = 26
local MECHANIC_DAZE = 27
local MECHANIC_DISCOVERY = 28
local MECHANIC_IMMUNE_SHIELD = 29
local MECHANIC_ENRAGED = 31

local MECHANIC_NAMES = {
    [MECHANIC_CHARM] = "CHARM",
    [MECHANIC_DISORIENTED] = "DISORIENTED",
    [MECHANIC_DISARM] = "DISARM",
    [MECHANIC_DISTRACT] = "DISTRACT",
    [MECHANIC_FEAR] = "FEAR",
    [MECHANIC_GRIP] = "GRIP",
    [MECHANIC_ROOT] = "ROOT",
    [MECHANIC_SLOW_ATTACK] = "SLOW_ATTACK",
    [MECHANIC_SILENCE] = "SILENCE",
    [MECHANIC_SLEEP] = "SLEEP",
    [MECHANIC_SNARE] = "SNARE",
    [MECHANIC_STUN] = "STUN",
    [MECHANIC_FREEZE] = "FREEZE",
    [MECHANIC_KNOCKOUT] = "KNOCKOUT",
    [MECHANIC_BLEED] = "BLEED",
    [MECHANIC_BANDAGE] = "BANDAGE",
    [MECHANIC_POLYMORPH] = "POLYMORPH",
    [MECHANIC_BANISH] = "BANISH",
    [MECHANIC_SHIELD] = "SHIELD",
    [MECHANIC_SHACKLE] = "SHACKLE",
    [MECHANIC_MOUNT] = "MOUNT",
    [MECHANIC_INFECTED] = "INFECTED",
    [MECHANIC_TURN] = "TURN",
    [MECHANIC_HORROR] = "HORROR",
    [MECHANIC_INVULNERABILITY] = "INVULNERABILITY",
    [MECHANIC_INTERRUPT] = "INTERRUPT",
    [MECHANIC_DAZE] = "DAZE",
    [MECHANIC_DISCOVERY] = "DISCOVERY",
    [MECHANIC_IMMUNE_SHIELD] = "IMMUNE_SHIELD",
    [MECHANIC_SAPPED] = "SAPPED",
    [MECHANIC_ENRAGED] = "ENRAGED",
}

local HARD_CC_MECHANICS = {
    [MECHANIC_CHARM] = true,
    [MECHANIC_DISORIENTED] = true,
    [MECHANIC_FEAR] = true,
    [MECHANIC_SILENCE] = true,
    [MECHANIC_SLEEP] = true,
    [MECHANIC_STUN] = true,
    [MECHANIC_FREEZE] = true,
    [MECHANIC_KNOCKOUT] = true,
    [MECHANIC_POLYMORPH] = true,
    [MECHANIC_BANISH] = true,
    [MECHANIC_SHACKLE] = true,
    [MECHANIC_HORROR] = true,
    [MECHANIC_SAPPED] = true,
}

local SOFT_CC_MECHANICS = {
    [MECHANIC_ROOT] = true,
    [MECHANIC_SLOW_ATTACK] = true,
    [MECHANIC_SNARE] = true,
    [MECHANIC_DAZE] = true,
}

local function mechanicMaskToNumber(mechanicMask)
    if not mechanicMask then return nil end
    if type(mechanicMask) == "number" then return mechanicMask end
    return tonumber(tostring(mechanicMask))
end

local function hasMechanic(mechanicMask, mechanic)
    local numericMask = mechanicMaskToNumber(mechanicMask)
    return numericMask and math.floor(numericMask / (2 ^ mechanic)) % 2 == 1
end

local function getMechanicNames(mechanicMask)
    local mechanics = {}
    for mechanic, name in pairs(MECHANIC_NAMES) do
        if hasMechanic(mechanicMask, mechanic) then
            table.insert(mechanics, name)
        end
    end
    return mechanics
end

local function getAbsorbEffectIndex(spellId)
    local spellInfo = GetSpellInfo(spellId)
    if not spellInfo then return nil end

    for effectIndex = 0, 2 do
        if spellInfo:GetEffectApplyAuraName(effectIndex) == SPELL_AURA_SCHOOL_ABSORB then
            return effectIndex
        end
    end
    return nil
end

local function getCCType(spellId)
    local spellInfo = GetSpellInfo(spellId)
    if not spellInfo then return nil end

    local mechanicMask = mechanicMaskToNumber(spellInfo:GetAllEffectsMechanicMask())
    for mechanic in pairs(HARD_CC_MECHANICS) do
        if hasMechanic(mechanicMask, mechanic) then return "HARD" end
    end
    for mechanic in pairs(SOFT_CC_MECHANICS) do
        if hasMechanic(mechanicMask, mechanic) then return "SOFT" end
    end
    return nil
end

-- Helper to get/initialize stats for a player, partitioned by instanceId
local function GetStats(player, instanceId)
    if player:IsBot() then return nil end
    if not isMatchStarted(player) then return nil end

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
            -- Display identity used by the payload and debug command.
            name = player:GetName(),
            playerGuid = guid,
            -- Dispelled enemy buffs or friendly debuffs.
            dispelsOffensive = 0,
            -- Dispelled friendly buffs or debuffs.
            dispelsDefensive = 0,
            -- Interruptible player casts successfully stopped by this player.
            successfulInterrupts = 0,
            -- Interrupt attempts received while this player was not casting.
            fakeCastInterrupts = 0,
            -- Number of hard crowd-control effects applied by this player.
            hardCCCount = 0,
            -- Total duration in milliseconds of hard crowd control applied.
            hardCCDuration = 0,
            -- Number of soft crowd-control effects applied by this player.
            softCCCount = 0,
            -- Total duration in milliseconds of soft crowd control applied.
            softCCDuration = 0,
            -- Amount of damage absorbed by this player's shields.
            absorbsDone = 0,
            -- Effective healing done to friendly flag carriers.
            healsOnFC = 0,
            -- Total time spent carrying a Warsong flag, in milliseconds.
            flagCarryTime = 0,
            -- Number of successful flag pickups by this player.
            attemptsOnFlag = 0,
            -- Damage dealt to enemy flag carriers.
            damageOnEFC = 0,
            -- Damage received by this player, including absorbed damage.
            damageTaken = 0,
            -- Native battleground killing-blow score.
            killingBlows = 0,
            -- Native battleground death score.
            deaths = 0,
            -- Native battleground honorable-kill score.
            honorableKills = 0,
            -- Native battleground bonus-honor score.
            bonusHonor = 0,
            -- Native battleground damage score.
            damageDone = 0,
            -- Native battleground effective-healing score.
            healingDone = 0,
            -- Native battleground flag-capture score.
            flagCaptures = 0,
            -- Native battleground flag-return score.
            flagReturns = 0,
            -- Whether the player left before the battleground ended.
            deserted = false,
            -- Internal millisecond cursor for incremental play-time updates.
            _updateTime = GetCurrTime(),
            -- Total active time in the battleground, in milliseconds.
            timePlayed = 0,
        }
    end
    return matchStats[instanceId][guid]
end

-- Cache native battleground scores while Player userdata is still valid.
local function snapshotPlayerScore(player, instanceId)
    if player:IsBot() then return end

    if not isMatchStarted(player) then
        local guid = tostring(player:GetGUID())
        local stats = instanceId and matchStats[instanceId] and matchStats[instanceId][guid]
        if stats then
            stats._updateTime = GetCurrTime()
        end
        return
    end

    local stats = GetStats(player, instanceId)
    if not stats then return end

    local now = GetCurrTime()
    if stats._updateTime then
        stats.timePlayed = stats.timePlayed + (now - stats._updateTime)
    end
    stats._updateTime = now

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
    if not player:InBattleground() or not isMatchStarted(player) then return end

    local spellId = spell:GetEntry()
    local target = spell:GetTarget()
    local targetPlayer = target and target:ToPlayer()
    local spellInfo = GetSpellInfo(spellId)
    local mechanicMask = spellInfo and spellInfo:GetAllEffectsMechanicMask()
    local mechanicMaskValue = mechanicMaskToNumber(mechanicMask)

    if DISPEL_PROTECTIVE_SPELLS[spellId] then
        if targetPlayer then
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
end)

-- Hook: Interrupt attempts resolved by the core
RegisterPlayerEvent(PLAYER_EVENT_ON_INTERRUPT_CAST, function(event, interrupter, target, targetWasCasting, successful)
    if not interrupter:InBattleground() or not target:InBattleground() then return end
    if interrupter:GetMapId() ~= WSG_MAP_ID or target:GetMapId() ~= WSG_MAP_ID then return end
    if not isMatchStarted(interrupter) or not isMatchStarted(target) then return end

    local instanceId = interrupter:GetBattlegroundId()
    if not instanceId or instanceId == 0 or target:GetBattlegroundId() ~= instanceId then return end

    -- A successful interrupt is credited to the player who interrupted.
    if successful and not interrupter:IsBot() then
        local stats = GetStats(interrupter, instanceId)
        if stats then
            stats.successfulInterrupts = stats.successfulInterrupts + 1
        end
    end

    -- A fake interrupt is credited to the player who was targeted while idle.
    if not targetWasCasting and not target:IsBot() then
        local targetStats = GetStats(target, instanceId)
        if targetStats then
            targetStats.fakeCastInterrupts = targetStats.fakeCastInterrupts + 1
        end
    end
end)

-- Hook: Aura application (for CC duration start, flag carrying, and shield absorbs)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_APPLY, function(event, player, aura)
    if not player:InBattleground() or not isMatchStarted(player) then return end
    local spellId = aura:GetAuraId()
    if not spellId then return end
    if WSG_FLAG_AURAS[spellId] then
        if not player:IsBot() then
            local guid = tostring(player:GetGUID())
            if not flagCarryStartTimes[guid] then
                local stats = GetStats(player)
                if stats then
                    stats.attemptsOnFlag = stats.attemptsOnFlag + 1
                end
                flagCarryStartTimes[guid] = GetCurrTime()
            end
        end
        return
    end

    local caster = aura:GetCaster()
    local casterPlayer = caster and caster:ToPlayer()
    if not caster then return end

    -- Resolve owner if the caster is a pet/totem/summon
    if caster:ToPlayer() then
        casterPlayer = caster:ToPlayer()
    else
        local owner = caster:GetOwner()
        if owner then casterPlayer = owner:ToPlayer() end
    end
    if not casterPlayer or casterPlayer:IsBot() then return end
    local ccType = getCCType(spellId)
    local absorbEffectIndex = getAbsorbEffectIndex(spellId)
    local absorbAmount = absorbEffectIndex and aura:GetEffectAmount(absorbEffectIndex)
    if ccType then
        -- Reapplying an existing aura refreshes it and fires OnAuraApply again
        -- without an intervening OnAuraRemove. Keep the original start time.
        local auraKey = tostring(aura)
        if not activeCCs[auraKey] then
            activeCCs[auraKey] = {
                caster = tostring(casterPlayer:GetGUID()),
                type = ccType,
                startTime = GetCurrTime(),
            }
        end
    end

    -- Track the full absorb amount; credit only the consumed amount on remove.
    if absorbEffectIndex and absorbAmount and absorbAmount > 0 then
        local instanceId = casterPlayer:GetBattlegroundId()

        local auraKey = tostring(aura)
        if not activeAbsorbs[auraKey] then
            activeAbsorbs[auraKey] = {
                caster = tostring(casterPlayer:GetGUID()),
                instanceId = instanceId,
                effectIndex = absorbEffectIndex,
                initialAmount = absorbAmount,
            }
        end
    end
end)

-- Hook: Aura removal (for calculating CC duration and flag carrying elapsed time)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_REMOVE, function(event, player, aura, remove_mode)
    if not player:InBattleground() or not isMatchStarted(player) then return end

    local auraKey = tostring(aura)
    local entry = activeCCs[auraKey]
    local now = GetCurrTime()
    if entry then
        local duration = now - entry.startTime
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
        activeCCs[auraKey] = nil
    end

    local absorbEntry = activeAbsorbs[auraKey]
    if absorbEntry then
        local remainingAmount = aura:GetEffectAmount(absorbEntry.effectIndex)
        local absorbedAmount = math.max(absorbEntry.initialAmount - remainingAmount, 0)
        if absorbedAmount > 0 then
            local stats = matchStats[absorbEntry.instanceId]
                and matchStats[absorbEntry.instanceId][absorbEntry.caster]
            if stats then
                stats.absorbsDone = stats.absorbsDone + absorbedAmount
            end

            if not player:IsBot() then
                local targetStats = GetStats(player, absorbEntry.instanceId)
                if targetStats then
                    targetStats.damageTaken = targetStats.damageTaken + absorbedAmount
                end
            end
        end
        activeAbsorbs[auraKey] = nil
    end

    local spellId = aura:GetAuraId()
    if spellId and WSG_FLAG_AURAS[spellId] then
        local guid = tostring(player:GetGUID())
        local startTime = flagCarryStartTimes[guid]
        if startTime then
            local elapsed = now - startTime
            if elapsed > 0 and not player:IsBot() then
                local stats = GetStats(player)
                if stats then
                    stats.flagCarryTime = stats.flagCarryTime + elapsed
                end
            end
            flagCarryStartTimes[guid] = nil
        end
    end
end)

-- Hook: Healing on friendly flag carriers
RegisterPlayerEvent(PLAYER_EVENT_ON_HEAL, function(event, player, target, heal)
    if player:IsBot() then return end
    if not player:InBattleground() or not isMatchStarted(player) then return end
    local targetPlayer = target and target:ToPlayer()
    print("[WSG Metrics][DEBUG] PLAYER_EVENT_ON_HEAL " .. inspect({
        player = player:GetName(),
        target = targetPlayer and targetPlayer:GetName() or nil,
        heal = heal,
    }))
    if not targetPlayer then return end
    local stats = GetStats(player)
    if not stats then return end
    -- If friendly target has either flag, track it as healing on friendly flag carrier
    if isFlagCarrier(targetPlayer) then
        stats.healsOnFC = stats.healsOnFC + heal
    end
end)

-- Hook: Damage dealt & damage taken tracking
RegisterPlayerEvent(PLAYER_EVENT_ON_DAMAGE, function(event, player, target, damage)
    if not player:InBattleground() or not isMatchStarted(player) then return end
    local targetPlayer = target and target:ToPlayer()
    if not targetPlayer then return end

    -- Track damage taken by the victim (only if target is not a bot)
    if not targetPlayer:IsBot() then
        local victimStats = GetStats(targetPlayer)
        if victimStats then
            victimStats.damageTaken = victimStats.damageTaken + damage
        end
    end

    -- Track damage done specifically to EFC by the attacker (only if attacker is not a bot)
    if player:IsBot() then return end
    local stats = GetStats(player)
    if not stats then return end
    if isFlagCarrier(targetPlayer) then
        stats.damageOnEFC = stats.damageOnEFC + damage
    end
end)

-- Hook: Track player desertion and total play time when leaving
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    if player:IsBot() then return end
    if not isMatchStarted(player) then return end

    local stats = GetStats(player, instanceId)
    if not stats then return end
    -- Record play time up to the point they left
    local now = GetCurrTime()
    local matchStart = matchStartTimes[instanceId] or stats._updateTime or now
    if stats._updateTime then
        stats.timePlayed = stats.timePlayed + (now - stats._updateTime)
        stats._updateTime = nil
    end
    if not bg then return end
    local status = bg:GetStatus()
    if status >= 4 then return end -- STATUS_WAIT_LEAVE is 4
    -- Store the exact second of the match when they deserted
    stats.deserted = math.floor((now - matchStart) / 1000)
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

        -- Active players are updated by the 500 ms snapshot loop; leavers are
        -- finalized by PLAYER_EVENT_ON_LEAVE_BG.
        stats.timePlayed = math.floor(stats.timePlayed / 1000)

        -- Clean up internal helper fields before sending
        stats._updateTime = nil

    end

    print("[WSG Metrics] Closing match instance -> " .. inspect({ instanceId = instanceId, winner = winner }))
    SendWebEvent('PVP_BG_STATS', nil, {
        instanceId = instanceId,
        winner = winner,
        players = currentMatchStats,
    })

    -- Clear stats only for this specific match instance
    matchStats[instanceId] = nil
    matchStartTimes[instanceId] = nil
end)

-- DEBUG
RegisterPlayerEvent(PLAYER_EVENT_ON_CHAT, function(event, player, msg, Type, lang)
    if not msg or msg:sub(1, 8):lower() ~= "?metrics" then
        return
    end

    local suffix = msg:sub(9)
    if suffix ~= "" and not suffix:match("^%s") then
        return
    end

    local query = suffix:match("^%s*(.-)%s*$")
    if not player:InBattleground() or player:GetMapId() ~= WSG_MAP_ID then
        return
    end

    local instanceId = player:GetBattlegroundId()
    local currentMatchStats = instanceId and matchStats[instanceId]
    if not currentMatchStats then
        player:SendBroadcastMessage("[WSG Metrics] No metrics available for this match yet.")
        return false
    end

    local metricKey = query ~= "" and query or nil
    local found = false
    for _, stats in pairs(currentMatchStats) do
        -- GetStats already excludes bots; keep the output limited to real players.
        local value = metricKey and stats[metricKey] or stats
        local hasValue = not metricKey or (value ~= nil and value ~= false and value ~= 0 and value ~= "")
        if hasValue then
            found = true
            if metricKey then
                player:SendBroadcastMessage("[WSG Metrics] " .. stats.name .. " -> " .. metricKey .. " = " .. inspect(value))
            else
                player:SendBroadcastMessage("[WSG Metrics] " .. stats.name .. " -> " .. inspect(stats))
            end
        end
    end

    if metricKey and not found then
        player:SendBroadcastMessage("[WSG Metrics] No players accumulated this metric yet.")
    elseif not metricKey and not found then
        player:SendBroadcastMessage("[WSG Metrics] No players are tracked in this match yet.")
    end

    return false
end)
