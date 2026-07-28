print("[WSG Metrics] Loading wsg-metrics.lua script...")

-- Global storage for active match statistics partitioned by instanceId
-- instanceId -> (playerGuidString -> statsTable)
local matchStats = {}
-- aura pointer string -> { caster = guidString, type = "HARD"|"SOFT", startTime = ms }
local activeCCs = {}
-- playerGuidString -> flagCarryStartTime
local flagCarryStartTimes = {}
-- instanceId -> matchStartTime
local matchStartTimes = {}
local WSG_MAP_ID = 489
local WSG_BG_TYPE_ID = 2
local HORDE_FLAG = 23333
local ALLIANCE_FLAG = 23335
local WSG_FLAG_AURAS = {
    [HORDE_FLAG] = "HORDE",
    [ALLIANCE_FLAG] = "ALLIANCE",
}

local function isFlagCarrier(player)
    return player:HasAura(HORDE_FLAG) or player:HasAura(ALLIANCE_FLAG)
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

-- 2. Shield / Absorb Spells definition (filtered to level 19 starting spells)
local SHIELD_SPELLS = {
    [17] = 150,     -- Power Word: Shield (Rank 1)
    [592] = 220,    -- Power Word: Shield (Rank 2)
    [600] = 300,    -- Power Word: Shield (Rank 3)
}

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
            _updateTime = GetCurrTime(),
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

    if player:InBattleground() then
        local spellId = spell:GetEntry()
        local target = spell:GetTarget()
        local targetPlayer = target and target:ToPlayer()
        local spellInfo = GetSpellInfo(spellId)
        local mechanicMask = spellInfo and spellInfo:GetAllEffectsMechanicMask()
        local mechanicMaskValue = mechanicMaskToNumber(mechanicMask)

        print("[WSG Metrics][DEBUG] PLAYER_EVENT_ON_SPELL_CAST " .. inspect({
            player = player:GetName(),
            spellId = spellId,
            target = targetPlayer and targetPlayer:GetName() or nil,
            mechanicMask = mechanicMaskValue,
            mechanics = getMechanicNames(mechanicMaskValue),
            skipCheck = skipCheck,
            recognizedDispel = DISPEL_PROTECTIVE_SPELLS[spellId] or false,
        }))

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
    end
end)

-- Hook: Aura application (for CC duration start, flag carrying, and shield absorbs)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_APPLY, function(event, player, aura)
    if player:InBattleground() then
        local spellId = aura:GetAuraId()
        if not spellId then return end

        -- Flag auras can have no caster, so track them before resolving the
        -- caster used by CC and shield attribution.
        if WSG_FLAG_AURAS[spellId] and not player:IsBot() then
            flagCarryStartTimes[tostring(player:GetGUID())] = GetCurrTime()
        end

        local caster = aura:GetCaster()
        local casterPlayer = caster and caster:ToPlayer()
        local ccType = getCCType(spellId)
        local shieldAmount = SHIELD_SPELLS[spellId]
        print("[WSG Metrics][DEBUG] PLAYER_EVENT_ON_AURA_APPLY " .. inspect({
            player = player:GetName(),
            spellId = spellId,
            caster = casterPlayer and casterPlayer:GetName() or nil,
            hasCaster = caster ~= nil,
            ccType = ccType,
            shieldAmount = shieldAmount,
        }))
        if not caster then return end

        -- Resolve owner if the caster is a pet/totem/summon
        if caster:ToPlayer() then
            casterPlayer = caster:ToPlayer()
        elseif caster:GetOwner() and caster:GetOwner():ToPlayer() then
            casterPlayer = caster:GetOwner():ToPlayer()
        end
        if not casterPlayer or casterPlayer:IsBot() then return end

        if ccType then
            activeCCs[tostring(aura)] = {
                caster = tostring(casterPlayer:GetGUID()),
                type = ccType,
                startTime = GetCurrTime(),
            }
        end

        -- Shield absorbs estimation
        if shieldAmount then
            local instanceId = casterPlayer:GetBattlegroundId()

            if player:GetGUID() ~= casterPlayer:GetGUID() then
                -- Attributed to the caster
                local stats = GetStats(casterPlayer, instanceId)
                if stats then
                    stats.absorbsDone = stats.absorbsDone + shieldAmount
                end

                -- Attributed to the target/victim
                if not player:IsBot() then
                    local targetStats = GetStats(player, instanceId)
                    if targetStats then
                        targetStats.damageTaken = targetStats.damageTaken + shieldAmount
                    end
                end
            end
        end
    end
end)

-- Hook: Aura removal (for calculating CC duration and flag carrying elapsed time)
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_REMOVE, function(event, player, aura, remove_mode)
    local auraKey = tostring(aura)
    local entry = activeCCs[auraKey]
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
        activeCCs[auraKey] = nil
    end

    local spellId = aura:GetAuraId()
    if spellId then
        if WSG_FLAG_AURAS[spellId] then
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

-- Hook: Healing on friendly flag carriers
RegisterPlayerEvent(PLAYER_EVENT_ON_HEAL, function(event, player, target, heal)
    if player:IsBot() then return end

    if player:InBattleground() and target:ToPlayer() then
        local targetPlayer = target:ToPlayer()
        if player:GetGUID() ~= targetPlayer:GetGUID() then
            local stats = GetStats(player)
            if stats then
                -- If friendly target has either flag, track it as healing on friendly flag carrier
                if isFlagCarrier(targetPlayer) then
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
            if isFlagCarrier(targetPlayer) then
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
