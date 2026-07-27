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

local function GetSelectedArenaTeamSize()
    if not PVPTeamDetails or not PVPTeamDetails.team or not GetArenaTeam then
        return nil
    end

    local _, teamSize = GetArenaTeam(PVPTeamDetails.team)
    return teamSize
end

local function UpdateArenaTeamDetails()
    local teamSize = GetSelectedArenaTeamSize()

    -- These teams are individual teams, so there is nobody to add.
    if PVPTeamDetailsAddTeamMember then
        PVPTeamDetailsAddTeamMember:Hide()
    end

    if PVPTeamDetailsSize then
        if teamSize == 5 then
            PVPTeamDetailsSize:SetText("(Battleground)")
            PVPTeamDetailsSize:Show()
        else
            PVPTeamDetailsSize:Show()
        end
    end

    -- Some client UI versions include the team size in the name region.
    -- if teamSize == 5 and PVPTeamDetailsName and PVPTeamDetailsName.GetText then
    --     local teamName = PVPTeamDetailsName:GetText()
    --     if teamName then
    --         PVPTeamDetailsName:SetText(teamName:gsub("%(5v5%)", "(Battleground)"))
    --     end
    -- end
end

local function HideArenaTeamLeaveButton()
    if PVPTeamDetails and PVPTeamDetails:IsShown() and DropDownList1Button4 then
        DropDownList1Button4:Hide()
    end
end

local arenaTeamUISetup = false

local function SetupArenaTeamUI()
    if arenaTeamUISetup then
        return
    end

    arenaTeamUISetup = true

    if PVPTeamDetails then
        PVPTeamDetails:HookScript("OnShow", UpdateArenaTeamDetails)
    end

    if type(PVPTeamDetails_Update) == "function" then
        hooksecurefunc("PVPTeamDetails_Update", UpdateArenaTeamDetails)
    end

    if DropDownList1Button4 then
        DropDownList1Button4:HookScript("OnShow", HideArenaTeamLeaveButton)
    end
end

local pvpQueueUISetup = false
local pvpQueueArenaSlot = nil
local function UpdatePVPQueueJoinButton() end
local pvpQueueArenaDescription = "All games are rated and you gain Arena Points directly after every victory.\n\nYou also gain Badges of Heroism: 2 for a victory and 1 for a loss.\n\nSolo queue only."

local function GetPVPBattlegroundFrame()
    return PVPBattlegroundFrame or BattlefieldFrame
end

local function GetPVPBattlegroundButton(index)
    return _G["BattlegroundType" .. index] or _G["BattlefieldZone" .. index]
end

local function SetPVPBattlegroundButtonText(button, text)
    if button.title then
        button.title:SetText(text)
    else
        button:SetText(text)
    end
end

local function UpdatePVPQueueDescription()
    if not pvpQueueArenaSlot then
        return
    end

    local description = PVPBattlegroundFrameInfoScrollFrameChildFrameDescription or
        BattlefieldFrameInfoScrollFrameChildFrameDescription
    local scrollFrame = PVPBattlegroundFrameInfoScrollFrame or BattlefieldFrameInfoScrollFrame

    if not description and scrollFrame then
        local scrollChild = scrollFrame:GetScrollChild()
        if scrollChild then
            description = scrollChild.Description or scrollChild.description or scrollChild.CFBGArenaDescription
            if not description then
                description = scrollChild:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
                description:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 0, 0)
                description:SetWidth(scrollFrame:GetWidth() - 20)
                description:SetJustifyH("LEFT")
                description:SetJustifyV("TOP")
                scrollChild.CFBGArenaDescription = description
            end
        end
    end

    if description then
        description:SetText(pvpQueueArenaDescription)
    end
end

local function FindWarsongGulch()
    if not GetNumBattlegroundTypes or not GetBattlegroundInfo then
        return nil
    end

    for index = 1, GetNumBattlegroundTypes() do
        local name, _, _, _, battlegroundId = GetBattlegroundInfo(index)
        if battlegroundId == 2 or (name and string.find(string.lower(name), "warsong")) then
            return index, name or "Warsong Gulch"
        end
    end
end

local function UpdatePVPQueueSelection()
    local frame = GetPVPBattlegroundFrame()
    if not frame then
        return
    end

    for index = 1, 3 do
        local button = GetPVPBattlegroundButton(index)
        if button then
            local selected = (index == 1 and not pvpQueueArenaSlot) or
                (button.CFBGArenaSlot == pvpQueueArenaSlot)
            if selected then
                button:LockHighlight()
            else
                button:UnlockHighlight()
            end
        end
    end
end

local function SelectPVPQueueOption(self)
    local frame = GetPVPBattlegroundFrame()
    if not frame then
        return
    end

    pvpQueueArenaSlot = self.CFBGArenaSlot
    if not pvpQueueArenaSlot then
        frame.selectedBG = self.BGindex
        if PVPBattleground_ResetInfo then
            PVPBattleground_ResetInfo()
        elseif BattlefieldFrame_ResetInfo then
            BattlefieldFrame_ResetInfo()
        end
        if PVPBattleground_UpdateJoinButton then
            PVPBattleground_UpdateJoinButton(self.BGindex)
        end
    end

    UpdatePVPQueueSelection()
    UpdatePVPQueueJoinButton()
    UpdatePVPQueueDescription()
end

local function JoinNormalBattleground(self)
    if JoinBattlefield then
        local groupJoinButton = PVPBattlegroundFrameGroupJoinButton or BattlefieldFrameGroupJoinButton
        JoinBattlefield(0, self == groupJoinButton)
    elseif PVPBattlegroundFrameJoinButton_OnClick then
        PVPBattlegroundFrameJoinButton_OnClick(self)
    elseif BattlefieldFrameJoinButton_OnClick then
        BattlefieldFrameJoinButton_OnClick(self)
    end
end

UpdatePVPQueueJoinButton = function()
    local frame = GetPVPBattlegroundFrame()
    local joinButton = PVPBattlegroundFrameJoinButton or BattlefieldFrameJoinButton
    local groupJoinButton = PVPBattlegroundFrameGroupJoinButton or BattlefieldFrameGroupJoinButton
    if not frame or not joinButton then
        return
    end

    if pvpQueueArenaSlot then
        joinButton:SetScript("OnClick", function()
            if JoinSkirmish then
                JoinSkirmish(pvpQueueArenaSlot)
                HideUIPanel(frame)
            end
        end)
        joinButton:Enable()
        if groupJoinButton then
            groupJoinButton:Hide()
        end
    else
        joinButton:SetScript("OnClick", JoinNormalBattleground)
        if groupJoinButton then
            groupJoinButton:SetScript("OnClick", JoinNormalBattleground)
            groupJoinButton:Show()
        end
    end
end

local function ApplyPVPQueueLayout()
    local frame = GetPVPBattlegroundFrame()
    local wsgIndex, wsgName = FindWarsongGulch()
    local button1 = GetPVPBattlegroundButton(1)
    local button2 = GetPVPBattlegroundButton(2)
    local button3 = GetPVPBattlegroundButton(3)
    if not frame or not wsgIndex or not button1 or not button2 or not button3 then
        return
    end

    if not pvpQueueArenaSlot then
        frame.selectedBG = wsgIndex
    end

    button1.BGindex = wsgIndex
    button1.CFBGArenaSlot = nil
    button1.localizedName = wsgName
    SetPVPBattlegroundButtonText(button1, wsgName)
    button1:SetScript("OnClick", SelectPVPQueueOption)
    button1:Enable()
    button1:Show()

    for index = 2, 3 do
        local button = GetPVPBattlegroundButton(index)
        button.BGindex = nil
        button.CFBGArenaSlot = index - 1
        button.localizedName = index == 2 and "2v2" or "3v3"
        SetPVPBattlegroundButtonText(button, button.localizedName)
        button:SetScript("OnClick", SelectPVPQueueOption)
        button:Enable()
        button:Show()
    end

    for index = 4, 5 do
        local button = GetPVPBattlegroundButton(index)
        if button then
            button:Hide()
        end
    end

    local scrollFrame = PVPBattlegroundFrameTypeScrollFrame or BattlefieldFrameTypeScrollFrame
    if scrollFrame then
        scrollFrame:Hide()
    end

    UpdatePVPQueueSelection()
    UpdatePVPQueueJoinButton()
    UpdatePVPQueueDescription()
end

local function SetupPVPQueueUI()
    if pvpQueueUISetup then
        return
    end

    local frame = GetPVPBattlegroundFrame()
    if not frame then
        return
    end

    pvpQueueUISetup = true
    frame:HookScript("OnShow", ApplyPVPQueueLayout)

    if type(PVPBattleground_UpdateBattlegrounds) == "function" then
        hooksecurefunc("PVPBattleground_UpdateBattlegrounds", ApplyPVPQueueLayout)
    end
    if type(PVPBattleground_UpdateJoinButton) == "function" then
        hooksecurefunc("PVPBattleground_UpdateJoinButton", UpdatePVPQueueJoinButton)
    end
    if type(BattlefieldFrame_UpdateGroupAvailable) == "function" then
        hooksecurefunc("BattlefieldFrame_UpdateGroupAvailable", UpdatePVPQueueJoinButton)
    end

    ApplyPVPQueueLayout()
end

-- Frame to manage initialization and event listening
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")

frame:SetScript("OnEvent", function(self, event, ...)
    if event == "PLAYER_LOGIN" then
        -- DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Scoreboard Fix Loaded!|r")

        SetupArenaTeamUI()
        SetupPVPQueueUI()
        
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
                -- DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Sending sync request to server...|r")
                SendAddonMessage("CFBG_SYNC", "REQ", "BATTLEGROUND")
            end)
        end
        
    elseif event == "PLAYER_ENTERING_WORLD" then
        SetupArenaTeamUI()
        SetupPVPQueueUI()

        wipe(CFBG_ScoreboardBots)
        wipe(CFBG_HordePlayers)
        wipe(CFBG_AlliancePlayers)
        
    elseif event == "CHAT_MSG_ADDON" then
        local prefix, message = ...
        if prefix == "CFBG_SYNC" then
            -- DEFAULT_CHAT_FRAME:AddMessage("|cff00ff00[CFBG Addon] Received sync payload:|r " .. tostring(message))
            
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
