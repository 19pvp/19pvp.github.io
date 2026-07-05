#include "Common.h"
#include "Chat.h"
#include "Configuration/Config.h"
#include "DatabaseEnv.h"
#include "Log.h"
#include "ObjectAccessor.h"
#include "ObjectGuid.h"
#include "Player.h"
#include "RandomPlayerbotMgr.h"
#include "ScriptMgr.h"

#include <string>
#include <vector>

using namespace Acore::ChatCommands;

namespace
{
struct WsgFixedRosterEntry
{
    ObjectGuid::LowType guid = 0;
    std::string account;
    std::string name;
    std::string role;
};

struct WsgFixedRosterItem
{
    uint32 item = 0;
    uint32 amount = 0;
};

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
        _roster.clear();

        if (!_enabled)
        {
            LOG_INFO("playerbots", "[WsgFixedBots] Disabled.");
            return;
        }

        QueryResult result = PlayerbotsDatabase.Query(
            "SELECT `guid`, `account`, `name`, `role` FROM `playerbots_fixed_roster` "
            "WHERE `enabled` = 1 AND `guid` IS NOT NULL ORDER BY `account`");

        if (!result)
        {
            LOG_INFO("playerbots", "[WsgFixedBots] Loaded 0 fixed roster bots.");
            return;
        }

        do
        {
            Field* fields = result->Fetch();

            WsgFixedRosterEntry entry;
            entry.guid = fields[0].Get<uint32>();
            entry.account = fields[1].Get<std::string>();
            entry.name = fields[2].Get<std::string>();
            entry.role = fields[3].Get<std::string>();
            _roster.push_back(entry);
        } while (result->NextRow());

        LOG_INFO("playerbots", "[WsgFixedBots] Loaded {} fixed roster bots.", _roster.size());
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

        QueryResult result = PlayerbotsDatabase.Query(
            "SELECT item.`item`, item.`amount` "
            "FROM `playerbots_fixed_roster` roster "
            "JOIN `playerbots_fixed_roster_item` item "
            "  ON item.`account` = roster.`account` "
            "WHERE roster.`guid` = {} AND roster.`enabled` = 1 AND item.`enabled` = 1 "
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

    std::size_t Reload()
    {
        LoadConfig();
        LoadFromDB();
        GrantConfiguredItemsToOnlineBots();
        return _roster.size();
    }

    void Update(uint32 diff)
    {
        if (!_enabled || _roster.empty())
            return;

        if (_timer > diff)
        {
            _timer -= diff;
            return;
        }

        _timer = _checkMs;

        for (WsgFixedRosterEntry const& entry : _roster)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(entry.guid);
            Player* bot = ObjectAccessor::FindConnectedPlayer(guid);

            if (bot && bot->IsInWorld())
                continue;

            sRandomPlayerbotMgr.AddPlayerBot(guid, 0);
        }
    }

private:
    bool _enabled = true;
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
    }
};

class WsgFixedBotsCommandScript : public CommandScript
{
public:
    WsgFixedBotsCommandScript() : CommandScript("WsgFixedBotsCommandScript") { }

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable wsgBotsCommandTable = {
            {"reload", HandleReloadCommand, SEC_GAMEMASTER, Console::Yes},
        };

        static ChatCommandTable commandTable = {
            {"wsgbots", wsgBotsCommandTable},
        };

        return commandTable;
    }

    static bool HandleReloadCommand(ChatHandler* handler, char const* /*args*/)
    {
        std::size_t const loaded = WsgFixedRosterMgr::Instance().Reload();
        handler->PSendSysMessage("Reloaded WSG fixed bot roster: {} enabled bot(s) with GUIDs.", loaded);
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
