const { app, Notification } = require('electron'),
    osLocale = require('os-locale'),
    fetch = require('node-fetch'),
    fs = require('fs'),
    path = require('path');

const CONFIG_PATH = path.join(process.env.APPDATA, 'Summoners War Exporter', 'storage', 'Config_repeat_battle_notifier.json'),
    DEFAULT_DELAY = 6000,
    DUNGEON_IDS = [8001, 9001, 6001, 9501, 9502, 9999],
    ENDPOINT = 'https://devilmon.me',
    ICON_PATH = path.join(__dirname, '/assets/images/icon.png'),
    PLUGIN_VERSION = '1.0.0',
    START_COMMANDS = [
        'BattleDimensionHoleDungeonStart',
        'BattleDungeonStart',
        'BattleEventInstanceStart',
        'battleInstanceStart',
        'BattleRiftDungeonStart',
        'BattleRiftOfWorldsRaidStart',
        'BattleScenarioStart'
    ], USER_COMMANDS = [
        '',
        'GetBestClearDungeon',
        'GetBlackMarketList',
        'GetDungeonBestTopRanking',
        'getDungeonUnitRatioList',
        'GetGuildBlackMarketList',
        'GetLobbyWizardLog',
        'GetMyWorldBossRanking',
        'GetMailList',
        'Harvest',
    ];

var clearTimes = [],
    currentDHoleEnergy = 0,
    currentDownTime = 0,
    currentEventCost = 0,
    currentRiftStage = -1,
    customConfig,
    locale = osLocale.sync(),
    notification,
    useKorean = locale == 'ko-KR';

// useKorean = true;

module.exports = {
    defaultConfig: {
        enabled: true,
        soundDelay: DEFAULT_DELAY,
        soundVolume: 4
    },
    defaultConfigDetails: {
        enabled: { label: useKorean ? '활성화' : 'enabled' },
        soundDelay: { label: useKorean ? '알림소리 딜레이 (밀리초 단위)' : 'Notification sound delay (in milliseconds)', type: 'input' },
        soundVolume: { label: useKorean ? '알림소리 크기 (0-10)' : 'Notification volume (0-10)', type: 'input' },
    },

    pluginName: useKorean ? '룬손실막이' : 'Repeat Battle Notifier',
    pluginDescription: useKorean ? '연속전투가 종료될때 알려줍니다.' : 'Notifies you when dungeon runs are complete.',

    init(proxy, config) {
        if (fs.existsSync(CONFIG_PATH))
            customConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        else {
            const weeklyStats = {};

            for (let i = 0; i < 7; i++) {
                weeklyStats[i] = { downTime: 0, runCount_unlisted: 0 };
                DUNGEON_IDS.forEach(dungeonId => {
                    weeklyStats[i][dungeonId] = { clearTime: 0, runCount: 0 };
                });
            }

            customConfig = {
                nextCheck: -1,
                totalStats: JSON.parse(JSON.stringify(weeklyStats[0])),
                userId: null,
                weeklyStats: weeklyStats
            }
            this.saveConfig(customConfig);
        }

        this.initPlugin(proxy, config);

        app.whenReady().then(() => {
            if (process.platform === 'win32')
                app.setAppUserModelId('com.electron.sw-exporter');

            //parseInt(config.Config.Plugins[this.pluginName].volume) / 100)

            if (!Notification.isSupported())
                this.log(proxy, 'warning', 'Your operating system does not support notifications.', '현재 사용하고 계신 운영체제에서는 푸쉬 알람을 지원하지 않습니다.');
        })

        app.on('will-quit', () => {
            // this.saveConfig(customConfig);
        });

        proxy.on('apiCommand', (req, res) => {
            if (notification && START_COMMANDS.includes(req.command))
                notification.close();

            // if (USER_COMMANDS.includes(req.command)) {
            //     // suppress notif for 5 seconds
            // }

            if (req?.wizard_id && customConfig?.userId != req.wizard_id) {
                customConfig.userId = req.wizard_id;
                this.saveConfig(customConfig);
            }
        });

        START_COMMANDS.forEach(command => {
            proxy.on(command, (req, res) => {
                if (config.Config.Plugins[this.pluginName].enabled) {
                    if (req?.auto_repeat === 1 && currentDownTime) {
                        currentDownTime = Date.now() - currentDownTime;
                        customConfig.weeklyStats[new Date().getDay()].downTime += currentDownTime < 3600000 ? currentDownTime : 0;
                        customConfig.totalStats.downTime += currentDownTime < 3600000 ? currentDownTime : 0;
                        this.saveConfig(customConfig);
                    }
                }
            });
        });

        proxy.on('battleRiftOfWorldsRaidCreateSingle', (req, res) => {
            currentRiftStage = req.stage_id;
        });

        proxy.on('BattleDimensionHoleDungeonStart', (req, res) => {
            currentDHoleEnergy = res.dimension_hole_info.energy;
        });

        proxy.on('BattleEventInstanceStart', (req, res) => {
            currentEventCost = res.event_instance_info.energy_cost;
        });

        proxy.on('battleInstanceStart', (req, res) => {
            currentEventCost = res.instance_info.energy_cost;
        });

        proxy.on('BattleDimensionHoleDungeonResult_v2', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2) {
                    this.failRun(proxy, config, null, null, 0);
                    currentDownTime = Date.now();
                } else {
                    const notEnoughEnergy = currentDHoleEnergy < 1; // add secondary checks later

                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10 || notEnoughEnergy)
                        this.completeRun(proxy, config, null, null, 50, notEnoughEnergy);

                    currentDownTime = Date.now() + 50;
                }
            }
        });

        proxy.on('BattleDungeonResult_V2', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2) {
                    this.failRun(proxy, config, req.dungeon_id, req.stage_id, 0);
                    currentDownTime = Date.now();
                } else {
                    const notEnoughEnergy = res.wizard_info.wizard_energy < this.getDungeonEnergyCost(req.dungeon_id, req.stage_id);

                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10 || notEnoughEnergy)
                        this.completeRun(proxy, config, req.dungeon_id, req.stage_id, this.getDungeonDelay(req.dungeon_id), notEnoughEnergy);

                    currentDownTime = Date.now() + this.getDungeonDelay(req.dungeon_id);
                }
            }
        });

        proxy.on('BattleRiftDungeonResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2) {
                    this.failRun(proxy, config, null, null, 0);
                    currentDownTime = Date.now();
                } else {
                    const notEnoughEnergy = res.wizard_info.wizard_energy < 8;

                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10 || notEnoughEnergy)
                        this.completeRun(proxy, config, null, null, 2000, notEnoughEnergy);

                    currentDownTime = Date.now() + 2000;
                }
            }
        });

        proxy.on('BattleEventInstanceResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                const notEnoughEnergy = res.wizard_info.wizard_energy < currentEventCost;

                clearTimes.push(req.clear_time);
                if (req.auto_repeat === 10 || notEnoughEnergy)
                    this.completeRun(proxy, config, null, null, 50, notEnoughEnergy);

                currentDownTime = Date.now() + 50;
            }
        });

        proxy.on('battleInstanceResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                const notEnoughEnergy = res.wizard_info.wizard_energy < currentEventCost;

                clearTimes.push(req.clear_time);
                if (req.auto_repeat === 10 || notEnoughEnergy)
                    this.completeRun(proxy, config, null, null, 50, notEnoughEnergy);

                currentDownTime = Date.now() + 50;
            }
        });

        proxy.on('BattleRiftOfWorldsRaidResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2) {
                    this.failRun(proxy, config, 9999, currentRiftStage, 0);
                    currentDownTime = Date.now();
                } else {
                    const notEnoughEnergy = res.wizard_info.wizard_energy < this.getDungeonEnergyCost(9999, currentRiftStage);

                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10 || notEnoughEnergy)
                        this.completeRun(proxy, config, 9999, currentRiftStage, 8560, notEnoughEnergy);

                    currentDownTime = Date.now() + 8560;
                }
            }
        });

        proxy.on('BattleScenarioResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2) {
                    this.failRun(proxy, config, null, null, 0);
                    currentDownTime = Date.now();
                } else {
                    const unitList = res.unit_list,
                        notEnoughEnergy = res.wizard_info.wizard_energy < this.getScenarioEnergyCost(res.scenario_info.region_id, res.scenario_info.stage_no);
                    var maxLevelReached = false;

                    for (let i = 0; i < unitList.length; i++)
                        if (unitList[i]?.level_up && unitList[i].unit_level >= unitList[i].class * 5 + 10) {
                            maxLevelReached = true;
                            break;
                        }

                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10 || notEnoughEnergy || maxLevelReached)
                        this.completeRun(proxy, config, null, null, 50, notEnoughEnergy, maxLevelReached);

                    currentDownTime = Date.now() + 50;
                }
            }
        });
    },

    checkVersion(proxy) {
        const date = new Date();

        if (customConfig?.nextCheck && date.getTime() > customConfig?.nextCheck) {
            const newDate = new Date(date.getTime() + 86400000);

            newDate.setHours(0, 0, 0, 0);
            customConfig.nextCheck = newDate.getTime();
            this.saveConfig(customConfig);

            return fetch(ENDPOINT + '/tools/srbn/latest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    version: PLUGIN_VERSION,
                    ...(customConfig?.userId && { id: customConfig.userId })
                })
            });
        } else {
            return new Promise((res, rej) => {
                res({
                    status: 200,
                    text: () => {
                        return new Promise((textRes, textRej) => {
                            textRes('latest');
                        });
                    }
                });
            });
        }
    },

    completeRun(proxy, config, dungeonId, stageId, additionalSoundDelay = 0, notEnoughEnergy = false, maxLevelReached = false) {
        const clearCount = clearTimes.length;
        var averageClearTime = 0,
            totalClearTime = 0,
            soundDelay = parseInt(config.Config.Plugins[this.pluginName].soundDelay) ?? DEFAULT_DELAY,
            soundVolume = parseInt(config.Config.Plugins[this.pluginName].soundVolume) ?? 5,
            todayStatReference = customConfig.weeklyStats[new Date().getDay()][dungeonId],
            totalStatReference = customConfig.totalStats[dungeonId];

        soundDelay = Math.max(0, Math.min(soundDelay, 60000));
        soundVolume = Math.max(0, Math.min(soundVolume, 10));

        clearTimes.forEach(clearTime => {
            totalClearTime += clearTime;
        });
        averageClearTime = ~~(totalClearTime / clearCount) / 1000;
        clearTimes = [];

        notification = new Notification({
            title: useKorean ? '룬손실!' : 'Run Complete!',
            body: useKorean ? `${maxLevelReached ? '몬스터 최대레벨 달성으로 ' : notEnoughEnergy ? '에너지 부족으로 ' : ''}연속전투가 종료되었습니다.\n평균 클리어 타임: ${averageClearTime}초` : `Repeat Battle has ${maxLevelReached ? 'ended for reaching MAX level' : notEnoughEnergy ? 'ended due to insufficient energy' : 'been completed'}.\nAvg. Clear Time: ${averageClearTime}s`,
            silent: true,
            icon: ICON_PATH,
            timeoutType: 'never'
        });

        setTimeout(() => {
            this.log(proxy, 'success',
                `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/c${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                Repeat Battle has ${maxLevelReached ? 'ended for reaching MAX level' : notEnoughEnergy ? 'ended due to insufficient energy' : 'been completed'}.<br><b>Avg. Clear Time:</b> ${this.formatTime(averageClearTime)} &nbsp; <b>Total time expended:</b> ${this.formatTime(totalClearTime)}`,
                `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/c${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                ${maxLevelReached ? '<b>몬스터 최대레벨 달성</b>으로 ' : notEnoughEnergy ? '/b>에너지 부족</b>으로 ' : ''}<b>연속전투가 종료</b>되었습니다.<br><b>평균 클리어 타임:</b> ${this.formatTime(averageClearTime)} &nbsp; <b>총 소요시간:</b> ${this.formatTime(totalClearTime)}`);

            notification.show();
            notification.on('click', () => {
                notification.close();
            });
        }, soundDelay + additionalSoundDelay);

        if (todayStatReference && this.isHighestStage(dungeonId, stageId)) {
            todayStatReference.clearTime += totalClearTime;
            todayStatReference.runCount += clearCount;
            totalStatReference.clearTime += totalClearTime;
            totalStatReference.runCount += clearCount;
            this.saveConfig(customConfig);
        }
    },

    failRun(proxy, config, dungeonId, stageId, additionalSoundDelay = 0) {
        const clearCount = clearTimes.length;
        var averageClearTime = 0,
            totalClearTime = 0,
            soundDelay = parseInt(config.Config.Plugins[this.pluginName].soundDelay) ?? DEFAULT_DELAY,
            soundVolume = parseInt(config.Config.Plugins[this.pluginName].soundVolume) ?? 5,
            todayStatReference = customConfig.weeklyStats[new Date().getDay()][dungeonId],
            totalStatReference = customConfig.totalStats[dungeonId];

        soundDelay = Math.max(0, Math.min(soundDelay, 60000));
        soundVolume = Math.max(0, Math.min(soundVolume, 10));

        clearTimes.forEach(clearTime => {
            totalClearTime += clearTime;
        });
        averageClearTime = ~~(totalClearTime / clearCount) / 1000;
        clearTimes = [];

        notification = new Notification({
            title: useKorean ? '룬손실!' : 'Run Complete!',
            body: useKorean ? `전투 패배로 연속전투가 종료되었습니다.${clearCount ? `\n평균 클리어 타임: ${averageClearTime}초` : ''}` : `Repeat Battle has been stopped.${clearCount ? `\nAvg. Clear Time: ${averageClearTime}s` : ''}`,
            silent: true,
            icon: ICON_PATH,
            timeoutType: 'never'
        });

        setTimeout(() => {
            this.log(proxy, 'warning',
                `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/f${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                Repeat Battle has been stopped.${clearCount ? `<br>Avg. Clear Time: ${this.formatTime(averageClearTime)} &nbsp; <b>Total time expended:</b> ${this.formatTime(totalClearTime)}` : ''}`,
                `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/f${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                <b>전투 패배</b>로 <b>연속전투가 종료</b>되었습니다.${clearCount ? `\n<b>평균 클리어 타임:</b> ${this.formatTime(averageClearTime)} &nbsp; <b>총 소요시간:</b> ${this.formatTime(totalClearTime)}` : ''}`);

            notification.show();
            notification.on('click', () => {
                notification.close();
            });
        }, soundDelay + additionalSoundDelay);

        if (todayStatReference && this.isHighestStage(dungeonId, stageId)) {
            todayStatReference.clearTime += totalClearTime;
            todayStatReference.runCount += clearCount;
            totalStatReference.clearTime += totalClearTime;
            totalStatReference.runCount += clearCount;
            this.saveConfig(customConfig);
        }
    },

    formatTime(timeInMS, useHTML = true) {
        timeInMS /= 1000;

        const milliseconds = ~~(timeInMS % 1 * 1000),
            seconds = ~~(timeInMS),
            minutes = ~~(seconds / 60),
            hours = ~~(minutes / 60);

        const sLabel = useKorean ? '초' : 's',
            mLabel = useKorean ? '분' : 'm',
            hLabel = useKorean ? '시간' : 'h';

        const openSpan = useHTML ? '<span style="font-size:11px">' : '',
            closeSpan = useHTML ? '</span>' : '';

        if (hours)
            return `${hours}${hLabel}` + (minutes ? `${openSpan} ${minutes % 60}${closeSpan}${mLabel}` : '');
        else if (minutes)
            return `${minutes}${mLabel}` + (seconds ? `${openSpan} ${seconds % 60}${closeSpan}${sLabel}` : '');

        return `${seconds % 60}.${openSpan}${milliseconds}${closeSpan}${sLabel}`;
    },

    getDungeonEnergyCost(dungeonId, stageId) {
        switch (dungeonId) {
            case 1001: // Dark
            case 2001: // Fire
            case 3001: // Water
            case 4001: // Wind
            case 5001: // Magic
            case 7001: // Light
                return [, 4, 4, 5, 5, 6, 6, 6, 7, 7, 7][stageId];
            case 6001: // NB
            case 8001: // GB
            case 9001: // DB
            case 9501: // SF
            case 9502: // PC
                return [, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 8, 9][stageId];
            case 9999: // Raid
                return [, 7, 8, 8, 9, 9][stageId];
            default:
                return 5;
        }
    },

    getDungeonDelay(dungeonId) {
        switch (dungeonId) {
            case 1001: // Dark
            case 2001: // Fire
            case 3001: // Water
            case 4001: // Wind
            case 5001: // Magic
            case 7001: // Light
                return 4500;
            case 6001: // NB
            case 8001: // GB
                return 4500;
            case 9001: // DB
                return 4500; //3350
            case 9501: // SF
            case 9502: // PC
                return 4500;
            default: // Secret Dungeon
                return 4500;
        }
    },

    getReport() {
        const report = {
            currentDay: new Date().getDay(),
            html: ''
        }

        this.getStats(useKorean ? '연속전투 통계 (오늘)' : 'Today\'s Stats', report, 0, 0);
        this.getStats(useKorean ? '연속전투 통계 (어제)' : 'Yesterday\'s Stats', report, 1, 1);
        this.getStats(useKorean ? '연속전투 통계 (최근 1주)' : 'This Week\'s Stats', report, 0, 7);
        this.getStats(useKorean ? '연속전투 통계 (전체)' : 'All Time Stats', report, -1, -1);

        return report.html;
    },

    getScenarioEnergyCost(regionId, difficulty) {
        return 2 + difficulty + (regionId < 7 ? 0 : 1);
    },

    getStats(title, report, startDay = -1, endDay = -1) {
        if (startDay < 0 || endDay < 0) {
            report.html += this.getStatTable(title, customConfig.totalStats);
        } else {
            const tempStats = JSON.parse(JSON.stringify(customConfig.weeklyStats[(report.currentDay + startDay) % 7]));

            for (let i = startDay + 1; i < endDay; i++) {
                const statsToCopy = customConfig.weeklyStats[(report.currentDay + i) % 7];

                DUNGEON_IDS.forEach(dungeonId => {
                    tempStats[dungeonId].clearTime += statsToCopy[dungeonId].clearTime;
                    tempStats[dungeonId].runCount += statsToCopy[dungeonId].runCount;
                });

                tempStats.downTime += statsToCopy.downTime;
                tempStats.runCount_unlisted += statsToCopy.runCount_unlisted;
            }

            report.html += this.getStatTable(title, tempStats);
        }
    },

    getStatTable(title, stats) {
        var runCountSum = 0,
            table =
                `<h3 style="text-align: center; width: min(100%, 600px)">${title}</h3>
        <table style="table-layout: fixed; width: min(100%, 600px)">
          <tr>
            <th style="text-align:center; width: 100px"></th>
            <th style="text-align:center">${useKorean ? '거던' : 'GB12'}</th>
            <th style="text-align:center">${useKorean ? '용던' : 'DB12'}</th>
            <th style="text-align:center">${useKorean ? '죽던' : 'NB12'}</th>
            <th style="text-align:center">${useKorean ? '강던' : 'SF10'}</th>
            <th style="text-align:center">${useKorean ? '심던' : 'PC10'}</th>
            <th style="text-align:center">${useKorean ? '레이드' : 'Raid'}</th>
          </tr>
          <tr>
            <td><b>${useKorean ? '평균 클리어 타임' : 'Avg. Clear Time'}</b></td>`;

        DUNGEON_IDS.forEach(dungeonId => {
            table += `<td style="text-align:center">${this.formatTime(stats[dungeonId].clearTime / stats[dungeonId].runCount)}</td>`;
            runCountSum += stats[dungeonId].runCount;
        });

        table += `</tr><tr><td><b>${useKorean ? '전체 클리어 타임' : 'Total Clear Time'}</b></td>`;

        DUNGEON_IDS.forEach(dungeonId => {
            table += `<td style="text-align:center">${this.formatTime(stats[dungeonId].clearTime)}</td>`;
        });

        table += `</tr><tr><td><b>${useKorean ? '평균 자사간 간격' : 'Avg. Downtime'}</b></td>
        <td style="text-align:center" colspan="6">${this.formatTime(stats.downTime / (runCountSum + stats.runCount_unlisted))}</td></tr></table>`;

        return table;
    },

    initPlugin(proxy, config) {
        this.checkVersion(proxy).then(res => {
            if (res.status === 200)
                res.text().then(version => {
                    const isLatest = version == 'latest';

                    if (!isLatest)
                        shell.openExternal('https://github.com/Jin-hjs/sw-repeat-battle-notifier/releases/latest');

                    if (config.Config.Plugins[this.pluginName].enabled)
                        this.log(proxy, isLatest ? 'success' : 'warning',
                            `${isLatest ? `✔️ You are using the latest version.<br>${this.getReport()}` : `❌ You are not up to date with the latest plugin.<br>${this.getReport()}`}`,
                            `${isLatest ? `✔️ 최신 버전을 사용중입니다.<br>${this.getReport()}` : `❌ 구버전을 사용중입니다.<br>${this.getReport()}`}`);
                });
            else
                if (config.Config.Plugins[this.pluginName].enabled)
                    this.log(proxy, 'error',
                        `❌ Unsuccessful retrieving plugin version.<br>${this.getReport()}`,
                        `❌ 버전 확인에 실패하였습니다.<br>${this.getReport()}`);
        });
    },

    isHighestStage(dungeonId, stageId) {
        if (stageId === 10 && (dungeonId === 9501 || dungeonId === 9502))
            return true;

        if (stageId === 12 && (dungeonId === 6001 || dungeonId === 8001 || dungeonId === 9001))
            return true;

        if (stageId === 5 && dungeonId === 9999)
            return true;

        return false;
    },

    log(proxy, messageType, message, messageInKorean = '') {
        proxy.log({
            type: messageType, source: 'plugin', name: this.pluginName,
            message: useKorean ? messageInKorean : message
        });
    },

    saveConfig(config, sync = false) {
        if (sync)
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config), { flag: 'w' });
        else
            fs.writeFile(CONFIG_PATH, JSON.stringify(config), { flag: 'w' }, error => {
                if (error)
                    this.log(proxy, 'error', `Failed to save plugin config.<br>${error}`, `플러그인 파일을 저장하는데 실패하였습니다.<br>${error}`);
            });
    }
};