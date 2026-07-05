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
    uint8 team = 0;
    uint8 slot = 0;
    std::string name;
    std::string role;
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

        PlayerbotsDatabase.Execute(
            "CREATE TABLE IF NOT EXISTS `playerbots_fixed_roster` ("
            "`guid` int unsigned NULL DEFAULT NULL,"
            "`team` tinyint unsigned NOT NULL,"
            "`slot` tinyint unsigned NOT NULL,"
            "`name` varchar(12) NOT NULL DEFAULT '',"
            "`account` varchar(32) NOT NULL DEFAULT '',"
            "`faction` varchar(16) NOT NULL DEFAULT '',"
            "`race` tinyint unsigned NOT NULL DEFAULT 0,"
            "`class` tinyint unsigned NOT NULL DEFAULT 0,"
            "`level` tinyint unsigned NOT NULL DEFAULT 19,"
            "`role` varchar(16) NOT NULL DEFAULT '',"
            "`spec` varchar(32) NOT NULL DEFAULT '',"
            "`replacement_priority` tinyint unsigned NOT NULL DEFAULT 0,"
            "`gear_profile` varchar(32) NOT NULL DEFAULT '',"
            "`behavior_profile` varchar(32) NOT NULL DEFAULT '',"
            "`enabled` tinyint(1) unsigned NOT NULL DEFAULT 1,"
            "PRIMARY KEY (`team`, `slot`),"
            "UNIQUE KEY `guid_unique` (`guid`),"
            "UNIQUE KEY `name_unique` (`name`),"
            "KEY `enabled` (`enabled`)"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        QueryResult result = PlayerbotsDatabase.Query(
            "SELECT `guid`, `team`, `slot`, `name`, `role` FROM `playerbots_fixed_roster` "
            "WHERE `enabled` = 1 AND `guid` IS NOT NULL ORDER BY `team`, `slot`");

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
            entry.team = fields[1].Get<uint8>();
            entry.slot = fields[2].Get<uint8>();
            entry.name = fields[3].Get<std::string>();
            entry.role = fields[4].Get<std::string>();

            if (entry.guid)
                _roster.push_back(entry);
        } while (result->NextRow());

        LOG_INFO("playerbots", "[WsgFixedBots] Loaded {} fixed roster bots.", _roster.size());
    }

    std::size_t Reload()
    {
        LoadConfig();
        LoadFromDB();
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
    new WsgFixedBotsCommandScript();
}
