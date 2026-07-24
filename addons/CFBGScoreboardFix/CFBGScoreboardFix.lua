-- Store original GetBattlefieldScore API
local original_GetBattlefieldScore = GetBattlefieldScore

-- Tables to store data synchronized from the server
local CFBG_ScoreboardBots = {}
local CFBG_HordePlayers = {}
local CFBG_AlliancePlayers = {}

-- Hook GetBattlefieldScore to return faked faction and tag bots for row rendering
GetBattlefieldScore = function(index)
    local name, killingBlows, honorableKills, deaths, honorGained, faction, rank, race, class, classToken, damageDone, healingDone = original_GetBattlefieldScore(index)
    
    if name then
        local actualFaction = faction
        
        -- Strip realm suffix (e.g. "Name-Realm" -> "Name") to match server names
        local cleanName = string.match(name, "^([^-]+)") or name
        
        -- Set faction value for row rendering (0 = Horde, 1 = Alliance)
        if CFBG_HordePlayers[cleanName] then
            actualFaction = 0
        elseif CFBG_AlliancePlayers[cleanName] then
            actualFaction = 1
        end
        
        -- Tag playerbots with a grey colored [BOT] prefix
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
            local _, _, _, _, _, actualFaction = GetBattlefieldScore(i)
            
            -- Invert actualFaction here for the header text calculation (0 = Horde, 1 = Alliance)
            if actualFaction == 0 then -- Horde
                if isBot then
                    hordeBots = hordeBots + 1
                else
                    hordeReal = hordeReal + 1
                end
            elseif actualFaction == 1 then -- Alliance
                if isBot then
                    allianceBots = allianceBots + 1
                else
                    allianceReal = allianceReal + 1
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
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")

frame:SetScript("OnEvent", function(self, event, ...)
    if event == "PLAYER_LOGIN" then
        DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Scoreboard Fix Loaded!|r")
        
        -- Hook the scoreboard update securely
        if hooksecurecall then
            hooksecurecall("WorldStateScoreFrame_Update", UpdateScoreboardHeaders)
        else
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
        
    elseif event == "PLAYER_ENTERING_WORLD" then
        wipe(CFBG_ScoreboardBots)
        wipe(CFBG_HordePlayers)
        wipe(CFBG_AlliancePlayers)
        
    elseif event == "CHAT_MSG_ADDON" then
        local prefix, message = ...
        if prefix == "CFBG_SYNC" then
            DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Received sync payload:|r " .. tostring(message))
            
            -- Split payload: "bot1,bot2;hordeplayer1,hordeplayer2;allianceplayer1,allianceplayer2"
            local botsSection, hordeSection, allianceSection = string.match(message, "^([^;]*);?([^;]*);?(.*)$")
            
            if botsSection and botsSection ~= "" then
                for botName in string.gmatch(botsSection, "[^,]+") do
                    CFBG_ScoreboardBots[botName] = true
                end
            end
            
            if hordeSection and hordeSection ~= "" then
                for playerName in string.gmatch(hordeSection, "[^,]+") do
                    CFBG_HordePlayers[playerName] = true
                    CFBG_AlliancePlayers[playerName] = nil
                end
            end
            
            if allianceSection and allianceSection ~= "" then
                for playerName in string.gmatch(allianceSection, "[^,]+") do
                    CFBG_AlliancePlayers[playerName] = true
                    CFBG_HordePlayers[playerName] = nil
                end
            end
            
            -- Refresh scoreboard to draw updated names, factions, and counts
            if WorldStateScoreFrame and WorldStateScoreFrame:IsShown() then
                WorldStateScoreFrame_Update()
            end
        end
    end
end)
