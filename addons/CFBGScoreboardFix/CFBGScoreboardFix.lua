-- Store original GetBattlefieldScore API
local original_GetBattlefieldScore = GetBattlefieldScore

-- Tables to store data synchronized from the server
local CFBG_ScoreboardBots = {}
local CFBG_HordePlayers = {}

-- Hook GetBattlefieldScore to return faked faction and tag bots
GetBattlefieldScore = function(index)
    local name, killingBlows, honorableKills, deaths, honorGained, faction, rank, race, class, classToken, damageDone, healingDone = original_GetBattlefieldScore(index)
    
    if name then
        local actualFaction = faction
        
        -- Strip realm suffix (e.g. "Name-Realm" -> "Name") to match server names
        local cleanName = string.match(name, "^([^-]+)") or name
        
        -- Override the faction only if we have received sync data from the server
        if next(CFBG_HordePlayers) ~= nil or next(CFBG_ScoreboardBots) ~= nil then
            -- Swapped: if the player is in the Horde list, faction is 1, else 0
            if CFBG_HordePlayers[cleanName] then
                actualFaction = 0 -- Alliance
            else
                actualFaction = 1 -- Horde
            end
        end
        
        -- Tag playerbots with a grey colored [BOT] prefix (color hex: ff9d9d9d)
        if CFBG_ScoreboardBots[cleanName] then
            name = "|cff9d9d9d[BOT]|r " .. name
        end
        
        return name, killingBlows, honorableKills, deaths, honorGained, actualFaction, rank, race, class, classToken, damageDone, healingDone
    end
    
    return name, killingBlows, honorableKills, deaths, honorGained, faction, rank, race, class, classToken, damageDone, healingDone
end

-- Hook function to update headers with real players vs bots counts
local function UpdateScoreboardHeaders()
    local numScores = GetNumBattlefieldScores()
    
    local allianceReal = 0
    local allianceBots = 0
    local hordeReal = 0
    local hordeBots = 0
    
    for i = 1, numScores do
        local name, _, _, _, _, faction = original_GetBattlefieldScore(i)
        if name then
            local cleanName = string.match(name, "^([^-]+)") or name
            local isBot = CFBG_ScoreboardBots[cleanName]
            -- Use the faked faction returned by our override
            local _, _, _, _, _, actualFaction = GetBattlefieldScore(i)
            
            if actualFaction == 0 then -- Alliance
                if isBot then
                    allianceBots = allianceBots + 1
                else
                    allianceReal = allianceReal + 1
                end
            elseif actualFaction == 1 then -- Horde
                if isBot then
                    hordeBots = hordeBots + 1
                else
                    hordeReal = hordeReal + 1
                end
            end
        end
    end
    
    -- Format singular/plural suffixes correctly
    local allySuffix = (allianceReal == 1) and "player" or "players"
    local hordeSuffix = (hordeReal == 1) and "player" or "players"
    
    -- Update the unified player count text (WorldStateScorePlayerCount)
    local playerCountText = _G["WorldStateScorePlayerCount"]
    if playerCountText then
        playerCountText:SetText(string.format("%d Alliance (%d %s) / %d Horde (%d %s)", 
            allianceReal + allianceBots, allianceReal, allySuffix,
            hordeReal + hordeBots, hordeReal, hordeSuffix))
    end
end

-- Frame to manage initialization and event listening
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_ADDON")

frame:SetScript("OnEvent", function(self, event, ...)
    if event == "PLAYER_LOGIN" then
        DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Scoreboard Fix Loaded!|r")
        
        -- Hook the scoreboard update securely
        if hooksecurecall then
            hooksecurecall("WorldStateScoreFrame_Update", UpdateScoreboardHeaders)
        else
            -- Fallback hook if hooksecurecall is somehow unavailable
            local original_Update = WorldStateScoreFrame_Update
            WorldStateScoreFrame_Update = function()
                original_Update()
                UpdateScoreboardHeaders()
            end
        end
        
        -- Hook the scoreboard opening to automatically request a data sync from the server
        if WorldStateScoreFrame then
            WorldStateScoreFrame:HookScript("OnShow", function()
                DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Sending sync request to server...|r")
                SendAddonMessage("CFBG_SYNC", "REQ", "BATTLEGROUND")
            end)
        end
        
    elseif event == "CHAT_MSG_ADDON" then
        local prefix, message = ...
        if prefix == "CFBG_SYNC" then
            DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Received sync payload:|r " .. tostring(message))
            
            wipe(CFBG_ScoreboardBots)
            wipe(CFBG_HordePlayers)
            
            -- Split payload: "bot1,bot2;hordeplayer1,hordeplayer2"
            local botsSection, hordeSection = string.match(message, "^([^;]*);(.*)$")
            
            if botsSection then
                for botName in string.gmatch(botsSection, "[^,]+") do
                    CFBG_ScoreboardBots[botName] = true
                end
            end
            
            if hordeSection then
                for playerName in string.gmatch(hordeSection, "[^,]+") do
                    CFBG_HordePlayers[playerName] = true
                end
            end
            
            -- Refresh scoreboard to draw updated names, factions, and counts
            if WorldStateScoreFrame and WorldStateScoreFrame:IsShown() then
                WorldStateScoreFrame_Update()
            end
        end
    end
end)
