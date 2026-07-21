#include "Common.h"
#include "AccountMgr.h"
#include "Chat.h"
#include "Configuration/Config.h"
#include "DatabaseEnv.h"
#include "Log.h"
#include "ObjectAccessor.h"
#include "ObjectGuid.h"
#include "Player.h"
#include "RandomPlayerbotMgr.h"
#include "ScriptMgr.h"
#include "WorldSession.h"
#include "Guild.h"
#include "GuildMgr.h"
#include "AiFactory.h"
#include "PlayerbotAIConfig.h"
#include "PlayerbotFactory.h"
#include "PlayerbotMgr.h"

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>
#include <thread>
#include <chrono>

using namespace Acore::ChatCommands;

namespace
{
struct WsgFixedRosterEntry
{
    ObjectGuid::LowType guid = 0;
    std::string account;
    std::string name;
    std::string role;
    std::string spec;
    uint8 race = 0;
    uint8 class_ = 0;
    uint8 gender = 255;
};

struct WsgFixedRosterItem
{
    uint32 item = 0;
    uint32 amount = 0;
};

std::string UpperAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c)
    {
        return static_cast<char>(std::toupper(c));
    });

    return value;
}

class WsgFixedRosterMgr
{
public:
    static WsgFixedRosterMgr& Instance()
    {
        static WsgFixedRosterMgr instance;
        return instance;
    }

    void LoadConfig()
    {
        _enabled = sConfigMgr->GetOption<bool>("WsgFixedBots.Enabled", true);
        _checkMs = sConfigMgr->GetOption<uint32>("WsgFixedBots.CheckFrequencySeconds", 5) * IN_MILLISECONDS;
        if (!_checkMs)
            _checkMs = 5 * IN_MILLISECONDS;
    }

    void LoadFromDB()
    {
        sRandomPlayerbotMgr.ClearFixedRosterCache();
        _roster.clear();

        if (!_enabled)
        {
            LOG_INFO("playerbots", "[WsgFixedBots] Disabled.");
            return;
        }

        QueryResult result = PlayerbotsDatabase.Query(
            "SELECT g.`guid`, r.`account`, r.`name`, r.`role`, r.`spec`, r.`race`, r.`class`, r.`gender` "
            "FROM `playerbots_fixed_roster` r "
            "LEFT JOIN `playerbots_fixed_roster_guid` g ON g.`account` = r.`account` "
            "WHERE r.`enabled` = 1 ORDER BY r.`account`");

        if (!result)
        {
            LOG_INFO("playerbots", "[WsgFixedBots] Loaded 0 fixed roster bots.");
            return;
        }

        do
        {
            Field* fields = result->Fetch();

            WsgFixedRosterEntry entry;
            entry.guid = fields[0].Get<uint32>(); // NULL values will naturally return 0
            entry.account = fields[1].Get<std::string>();
            entry.name = fields[2].Get<std::string>();
            entry.role = fields[3].Get<std::string>();
            entry.spec = fields[4].Get<std::string>();
            entry.race = fields[5].Get<uint8>();
            entry.class_ = fields[6].Get<uint8>();
            entry.gender = fields[7].Get<uint8>();
            _roster.push_back(entry);
        } while (result->NextRow());

        LOG_INFO("playerbots", "[WsgFixedBots] Loaded {} fixed roster bots.", _roster.size());

        CreateMissingBots();
    }

    void CreateMissingBots()
    {
        if (!_enabled || _roster.empty())
            return;

        for (WsgFixedRosterEntry& entry : _roster)
        {
            // 1. Ensure account exists
            uint32 accountId = AccountMgr::GetId(entry.account);
            if (!accountId)
            {
                AccountOpResult result = sAccountMgr->CreateAccount(entry.account, entry.account);
                if (result != AOR_OK)
                {
                    LOG_ERROR("playerbots", "[WsgFixedBots] Failed to create account {} for fixed bot {}", entry.account, entry.name);
                    continue;
                }
                
                // sAccountMgr->CreateAccount executes asynchronously, so we wait/retry for the DB to complete
                int retries = 0;
                while (!accountId && retries < 20)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                    accountId = AccountMgr::GetId(entry.account);
                    retries++;
                }

                if (!accountId)
                {
                    LOG_ERROR("playerbots", "[WsgFixedBots] Failed to retrieve account ID for newly created account {} (timeout)", entry.account);
                    continue;
                }
                LOG_INFO("playerbots", "[WsgFixedBots] Created account {} for fixed bot {}", entry.account, entry.name);
            }

            // 2. Ensure character exists
            bool characterExists = false;
            if (entry.guid != 0)
            {
                QueryResult checkResult = CharacterDatabase.Query("SELECT 1 FROM characters WHERE guid = {}", entry.guid);
                if (checkResult)
                    characterExists = true;
            }

            if (!characterExists)
            {
                // Determine the guid to use
                ObjectGuid::LowType guidToUse = entry.guid;
                if (guidToUse == 0)
                {
                    guidToUse = sObjectMgr->GetGenerator<HighGuid::Player>().Generate();
                }
                else
                {
                    // Double check for conflicts
                    QueryResult checkConflict = CharacterDatabase.Query("SELECT 1 FROM characters WHERE guid = {}", guidToUse);
                    if (checkConflict)
                    {
                        guidToUse = sObjectMgr->GetGenerator<HighGuid::Player>().Generate();
                    }
                }

                LOG_INFO("playerbots", "[WsgFixedBots] Character {} (GUID {}) does not exist. Creating...", entry.name, guidToUse);

                // Create a temporary session
                WorldSession* session = new WorldSession(accountId, "", 0x0, nullptr, SEC_PLAYER, EXPANSION_WRATH_OF_THE_LICH_KING,
                                                        time_t(0), LOCALE_enUS, 0, false, false, 0, true);

                uint8 gender = entry.gender == 255 ? (urand(0, 1) ? GENDER_MALE : GENDER_FEMALE) : entry.gender;
                uint8 skin = 0;
                uint8 face = 0;
                uint8 hairStyle = 0;
                uint8 hairColor = 0;
                uint8 facialHair = 0;

                std::unique_ptr<CharacterCreateInfo> characterInfo = std::make_unique<CharacterCreateInfo>(
                    entry.name, entry.race, entry.class_, gender, skin, face, hairStyle, hairColor, facialHair);

                Player* player = new Player(session);
                player->GetMotionMaster()->Initialize();

                if (player->Create(guidToUse, characterInfo.get()))
                {
                    player->SetLevel(19);
                    player->SaveToDB(true, false);
                    sCharacterCache->AddCharacterCacheEntry(player->GetGUID(), accountId, player->GetName(),
                                                            player->getGender(), player->getRace(),
                                                            player->getClass(), player->GetLevel());

                    // Save new GUID to the entry and update the relation table
                    entry.guid = guidToUse;
                    PlayerbotsDatabase.Execute(
                        "INSERT INTO `playerbots_fixed_roster_guid` (`account`, `guid`) "
                        "VALUES ('{}', {}) "
                        "ON DUPLICATE KEY UPDATE `guid` = {}",
                        entry.account, guidToUse, guidToUse);

                    LOG_INFO("playerbots", "[WsgFixedBots] Successfully created level 19 character {} (GUID {}).", entry.name, guidToUse);
                }
                else
                {
                    LOG_ERROR("playerbots", "[WsgFixedBots] Failed to create character {} programmatically.", entry.name);
                }

                player->CleanupsBeforeDelete();
                delete player;
                delete session;
            }
        }
    }

    bool IsFixedBot(ObjectGuid::LowType guid) const
    {
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            if (entry.guid == guid)
                return true;
        }

        return false;
    }

    void GrantConfiguredItems(Player* player)
    {
        if (!_enabled || !player)
            return;

        ObjectGuid::LowType const playerGuid = player->GetGUID().GetCounter();
        if (!IsFixedBot(playerGuid))
            return;

        uint32 const replacedStarterItemCount = player->GetItemCount(4368, true);
        if (replacedStarterItemCount)
        {
            player->DestroyItemCount(4368, replacedStarterItemCount, true, true);
            LOG_INFO("playerbots", "[WsgFixedBots] Removed replaced starter item 4368 from {}.", player->GetName());
        }

        QueryResult result = PlayerbotsDatabase.Query(
            "SELECT item.`item`, item.`amount` "
            "FROM `playerbots_fixed_roster` roster "
            "JOIN `playerbots_fixed_roster_item` item "
            "  ON item.`account` = roster.`account` "
            "JOIN `playerbots_fixed_roster_guid` g "
            "  ON g.`account` = roster.`account` "
            "WHERE g.`guid` = {} AND roster.`enabled` = 1 AND item.`enabled` = 1 "
            "ORDER BY item.`item`",
            playerGuid);

        if (!result)
            return;

        uint32 granted = 0;
        do
        {
            Field* fields = result->Fetch();
            WsgFixedRosterItem item;
            item.item = fields[0].Get<uint32>();
            item.amount = fields[1].Get<uint32>();

            if (!item.item || !item.amount)
                continue;

            uint32 const current = player->GetItemCount(item.item, true);
            if (current >= item.amount)
                continue;

            uint32 const missing = item.amount - current;
            if (player->StoreNewItemInBestSlots(item.item, missing))
                granted += missing;
        } while (result->NextRow());

        if (granted)
            LOG_INFO("playerbots", "[WsgFixedBots] Granted {} configured item(s) to {}.", granted, player->GetName());
    }

    void GrantConfiguredItemsToOnlineBots()
    {
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);
            if (bot && bot->IsInWorld())
                GrantConfiguredItems(bot);
        }
    }

    void EnsureGuildMembership(Player* player)
    {
        if (!_enabled || !player)
            return;

        ObjectGuid::LowType const playerGuid = player->GetGUID().GetCounter();
        if (!IsFixedBot(playerGuid))
            return;

        Guild* guild = sGuildMgr->GetGuildByName("WIP");

        // If the player is already in another guild, remove them first to prevent errors
        if (player->GetGuildId() && (!guild || player->GetGuildId() != guild->GetId()))
        {
            if (Guild* oldGuild = sGuildMgr->GetGuildById(player->GetGuildId()))
            {
                oldGuild->DeleteMember(player->GetGUID(), false, false);
                player->SetInGuild(0);
            }
        }

        if (!guild)
        {
            guild = new Guild();
            if (guild->Create(player, "WIP"))
            {
                sGuildMgr->AddGuild(guild);
                LOG_INFO("playerbots", "[WsgFixedBots] Created new guild 'WIP' with leader {}.", player->GetName());
            }
            else
            {
                delete guild;
                guild = nullptr;
                LOG_ERROR("playerbots", "[WsgFixedBots] Failed to create guild 'WIP' programmatically.");
            }
        }
        else
        {
            if (player->GetGuildId() != guild->GetId())
            {
                guild->AddMember(player->GetGUID());
                LOG_INFO("playerbots", "[WsgFixedBots] Added bot {} to guild 'WIP'.", player->GetName());
            }
        }
    }

    void EnsureGuildMembershipForOnlineBots()
    {
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);
            if (bot && bot->IsInWorld())
                EnsureGuildMembership(bot);
        }
    }

    void ApplyConfiguredSpecsToOnlineBots()
    {
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            if (entry.class_ != CLASS_WARRIOR || entry.spec != "protection")
                continue;

            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);
            PlayerbotAI* botAI = bot ? sPlayerbotsMgr.GetPlayerbotAI(bot) : nullptr;
            if (!bot || !bot->IsInWorld() || !botAI ||
                AiFactory::GetPlayerSpecTab(bot) == WARRIOR_TAB_PROTECTION)
            {
                continue;
            }

            int specNo = -1;
            for (int i = 0; i < MAX_SPECNO; ++i)
            {
                if (sPlayerbotAIConfig.premadeSpecName[CLASS_WARRIOR][i] == "prot pvp")
                {
                    specNo = i;
                    break;
                }
            }

            if (specNo == -1)
            {
                LOG_ERROR("playerbots", "[WsgFixedBots] Could not find the warrior prot pvp talent spec.");
                continue;
            }

            PlayerbotFactory::InitTalentsBySpecNo(bot, specNo, true);
            botAI->ResetStrategies();
            LOG_INFO("playerbots", "[WsgFixedBots] Applied prot pvp talents to {}.", entry.name);
        }
    }

    std::size_t Reload()
    {
        LoadConfig();
        LoadFromDB();
        GrantConfiguredItemsToOnlineBots();
        EnsureGuildMembershipForOnlineBots();
        return _roster.size();
    }

    bool RequestRecreate()
    {
        if (!_enabled || _roster.empty() || _recreatePending)
            return false;

        _recreatePending = true;
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);
            if (!bot)
                continue;

            sRandomPlayerbotMgr.LogoutPlayerBot(guid);
        }

        LOG_INFO("playerbots", "[WsgFixedBots] Roster recreation requested; logging out bots through the playerbot manager.");
        return true;
    }

    bool AnyRosterBotOnline() const
    {
        return std::any_of(_roster.begin(), _roster.end(), [](WsgFixedRosterEntry const& entry)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            return ObjectAccessor::FindConnectedPlayer(guid) != nullptr;
        });
    }

    bool ValidateRecreateEntry(WsgFixedRosterEntry const& entry) const
    {
        if (!entry.guid)
            return true;

        uint32 accountId = AccountMgr::GetId(entry.account);
        if (!accountId)
        {
            LOG_ERROR("playerbots", "[WsgFixedBots] Cannot recreate {}: account {} does not exist.",
                entry.name, entry.account);
            return false;
        }

        QueryResult character = CharacterDatabase.Query(
            "SELECT `account`, `name` FROM `characters` WHERE `guid` = {}", entry.guid);
        if (!character)
            return true;

        Field* fields = character->Fetch();
        uint32 characterAccount = fields[0].Get<uint32>();
        std::string characterName = fields[1].Get<std::string>();
        if (characterAccount == accountId && characterName == entry.name)
            return true;

        LOG_ERROR("playerbots",
            "[WsgFixedBots] Refusing to recreate {}: GUID {} belongs to account {} / character {}.",
            entry.name, entry.guid, characterAccount, characterName);
        return false;
    }

    void CompleteRecreate()
    {
        for (WsgFixedRosterEntry const& entry : _roster)
        {
            if (!ValidateRecreateEntry(entry))
            {
                _recreatePending = false;
                return;
            }
        }

        for (WsgFixedRosterEntry const& entry : _roster)
        {
            if (!entry.guid)
                continue;

            uint32 accountId = AccountMgr::GetId(entry.account);
            QueryResult character = CharacterDatabase.Query(
                "SELECT 1 FROM `characters` WHERE `guid` = {}", entry.guid);
            if (character)
                Player::DeleteFromDB(entry.guid, accountId, true, true);
        }

        PlayerbotsDatabase.Execute("DELETE FROM `playerbots_fixed_roster_guid`");
        sRandomPlayerbotMgr.ClearFixedRosterCache();
        _roster.clear();
        _recreatePending = false;
        LoadFromDB();
        LOG_INFO("playerbots", "[WsgFixedBots] Roster recreation complete; recreated {} bot character(s).", _roster.size());
    }

    void LogLoginDiagnostics(WsgFixedRosterEntry const& entry, ObjectGuid guid, uint32 cacheAccountId) const
    {
        QueryResult characterResult = CharacterDatabase.Query(
            "SELECT `account`, `name`, `race`, `class`, `level`, `online` "
            "FROM `characters` WHERE `guid` = {}",
            entry.guid);

        if (!characterResult)
        {
            LOG_ERROR("playerbots", "[WsgFixedBots] Login diagnostic for {}: no character row for GUID {}.",
                entry.name, entry.guid);
            return;
        }

        Field* characterFields = characterResult->Fetch();
        uint32 const characterAccountId = characterFields[0].Get<uint32>();
        std::string const characterName = characterFields[1].Get<std::string>();
        uint8 const characterRace = characterFields[2].Get<uint8>();
        uint8 const characterClass = characterFields[3].Get<uint8>();
        uint8 const characterLevel = characterFields[4].Get<uint8>();
        uint8 const characterOnline = characterFields[5].Get<uint8>();

        LOG_INFO("playerbots",
            "[WsgFixedBots] Login diagnostic for {}: character account={}, name={}, race={}, class={}, level={}, online={}, cacheAccount={}.",
            entry.name, characterAccountId, characterName, uint32(characterRace), uint32(characterClass),
            uint32(characterLevel), uint32(characterOnline), cacheAccountId);

        if (characterAccountId != cacheAccountId)
        {
            LOG_WARN("playerbots",
                "[WsgFixedBots] Login diagnostic for {}: character account {} differs from cache account {}.",
                entry.name, characterAccountId, cacheAccountId);
        }

        if (characterName != entry.name || characterRace != entry.race || characterClass != entry.class_)
        {
            LOG_WARN("playerbots",
                "[WsgFixedBots] Login diagnostic for {}: roster mismatch, roster name/race/class={}/{}/{} but character name/race/class={}/{}/{}.",
                entry.name, entry.name, uint32(entry.race), uint32(entry.class_), characterName,
                uint32(characterRace), uint32(characterClass));
        }

        QueryResult accountResult = LoginDatabase.Query(
            "SELECT `username`, `online`, `locked`, `expansion` FROM `account` WHERE `id` = {}",
            characterAccountId);

        if (!accountResult)
        {
            LOG_ERROR("playerbots",
                "[WsgFixedBots] Login diagnostic for {}: no auth account row for account id {}.",
                entry.name, characterAccountId);
            return;
        }

        Field* accountFields = accountResult->Fetch();
        std::string const username = accountFields[0].Get<std::string>();
        uint8 const accountOnline = accountFields[1].Get<uint8>();
        uint8 const accountLocked = accountFields[2].Get<uint8>();
        uint8 const accountExpansion = accountFields[3].Get<uint8>();

        LOG_INFO("playerbots",
            "[WsgFixedBots] Login diagnostic for {}: auth username={}, online={}, locked={}, expansion={}.",
            entry.name, username, uint32(accountOnline), uint32(accountLocked), uint32(accountExpansion));

        if (UpperAscii(username) != UpperAscii(entry.account))
        {
            LOG_WARN("playerbots",
                "[WsgFixedBots] Login diagnostic for {}: roster account key {} differs from auth username {}.",
                entry.name, entry.account, username);
        }

        Player* connected = ObjectAccessor::FindConnectedPlayer(guid);
        LOG_INFO("playerbots",
            "[WsgFixedBots] Login diagnostic for {}: connectedPlayer={}, inWorld={}.",
            entry.name, connected ? 1 : 0, connected && connected->IsInWorld() ? 1 : 0);
    }

    void Update(uint32 diff)
    {
        if (_recreatePending)
        {
            if (AnyRosterBotOnline())
                return;

            CompleteRecreate();
            return;
        }

        if (!_enabled || _roster.empty())
            return;

        if (_timer > diff)
        {
            _timer -= diff;
            return;
        }

        _timer = _checkMs;

        ApplyConfiguredSpecsToOnlineBots();

        for (WsgFixedRosterEntry const& entry : _roster)
        {
            if (entry.guid == 0)
            {
                LOG_WARN("playerbots", "[WsgFixedBots] Bot {} has GUID 0, skipping login.", entry.name);
                continue;
            }

            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);

            if (bot && bot->IsInWorld())
            {
                LOG_DEBUG("playerbots", "[WsgFixedBots] Bot {} (GUID {}) is already online.", entry.name, entry.guid);
                continue;
            }

            uint32 cacheAccountId = sCharacterCache->GetCharacterAccountIdByGuid(guid);
            LOG_INFO("playerbots", "[WsgFixedBots] Attempting to login bot {} (GUID {}, Account ID in cache: {})...", 
                     entry.name, entry.guid, cacheAccountId);
            LogLoginDiagnostics(entry, guid, cacheAccountId);

            sRandomPlayerbotMgr.RegisterManualRandomBot(entry.guid, cacheAccountId);
            sRandomPlayerbotMgr.AddPlayerBot(guid, 0);

            Player* postLoginBot = ObjectAccessor::FindConnectedPlayer(guid);
            if (postLoginBot && postLoginBot->IsInWorld())
            {
                LOG_INFO("playerbots", "[WsgFixedBots] AddPlayerBot connected {} immediately.", entry.name);
            }
            else
            {
                LOG_WARN("playerbots",
                    "[WsgFixedBots] AddPlayerBot returned but {} is not connected yet (connectedPlayer={}, inWorld={}). Check following playerbot/login errors for rejection reason.",
                    entry.name, postLoginBot ? 1 : 0, postLoginBot && postLoginBot->IsInWorld() ? 1 : 0);
            }
        }
    }

private:
    bool _enabled = true;
    bool _recreatePending = false;
    uint32 _checkMs = 5 * IN_MILLISECONDS;
    uint32 _timer = 0;
    std::vector<WsgFixedRosterEntry> _roster;
};

class WsgFixedBotsWorldScript : public WorldScript
{
public:
    WsgFixedBotsWorldScript() : WorldScript("WsgFixedBotsWorldScript") { }

    void OnStartup() override
    {
        WsgFixedRosterMgr::Instance().LoadConfig();
        WsgFixedRosterMgr::Instance().LoadFromDB();
    }

    void OnUpdate(uint32 diff) override
    {
        WsgFixedRosterMgr::Instance().Update(diff);
    }
};

class WsgFixedBotsPlayerScript : public PlayerScript
{
public:
    WsgFixedBotsPlayerScript() : PlayerScript("WsgFixedBotsPlayerScript", {PLAYERHOOK_ON_LOGIN}) { }

    void OnPlayerLogin(Player* player) override
    {
        WsgFixedRosterMgr::Instance().GrantConfiguredItems(player);
        WsgFixedRosterMgr::Instance().EnsureGuildMembership(player);
    }
};

class WsgFixedBotsCommandScript : public CommandScript
{
public:
    WsgFixedBotsCommandScript() : CommandScript("WsgFixedBotsCommandScript") { }

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable rosterBotsCommandTable = {
            {"recreate", HandleRecreateCommand, SEC_GAMEMASTER, Console::Yes},
            {"reload", HandleReloadCommand, SEC_GAMEMASTER, Console::Yes},
        };

        static ChatCommandTable commandTable = {
            {"rosterbots", rosterBotsCommandTable},
        };

        return commandTable;
    }

    static bool HandleReloadCommand(ChatHandler* handler, char const* /*args*/)
    {
        std::size_t const loaded = WsgFixedRosterMgr::Instance().Reload();
        handler->PSendSysMessage("Reloaded WSG fixed bot roster: {} enabled bot(s) with GUIDs.", loaded);
        return true;
    }

    static bool HandleRecreateCommand(ChatHandler* handler, char const* /*args*/)
    {
        if (!WsgFixedRosterMgr::Instance().RequestRecreate())
        {
            handler->SendSysMessage("WSG fixed bot roster recreation is already pending, disabled, or empty.");
            return false;
        }

        handler->SendSysMessage("WSG fixed bots are logging out. Their characters will be deleted and recreated shortly.");
        return true;
    }
};
}

void Addmod_playerbots_fixed_rosterScripts()
{
    new WsgFixedBotsWorldScript();
    new WsgFixedBotsPlayerScript();
    new WsgFixedBotsCommandScript();
}
