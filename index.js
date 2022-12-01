const { app, shell, Notification } = require('electron'),
    osLocale = require('os-locale'),
    fetch = require('node-fetch'),
    fs = require('fs'),
    path = require('path');

const CONFIG_PATH = path.join(process.env.APPDATA, 'Summoners War Exporter', 'storage', 'Config_repeat_battle_notifier.json'),
    DEFAULT_DELAY = 10500,
    ENDPOINT = 'https://devilmon.me',
    ICON_PATH = path.join(__dirname, '/assets/images/icon.png'),
    PLUGIN_VERSION = '1.0.0',
    START_COMMANDS = [
        'BattleDungeonStart',
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
    customConfig,
    locale = osLocale.sync(),
    notification,
    useKorean = locale == 'ko-KR',

useKorean = true;
//TODO: test english

module.exports = {
    defaultConfig: {
        enabled: true,
        soundDelay: DEFAULT_DELAY,
        soundVolume: 5
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
            customConfig = {
                nextCheck: -1,
                userId: null
            }
            this.saveConfig(customConfig);
        }

        this.initPlugin(proxy, config);

        app.whenReady().then(() => {
            if (process.platform === 'win32')
                app.setAppUserModelId('com.electron.sw-exporter');

            //parseInt(config.Config.Plugins[this.pluginName].volume) / 100)

            if (!Notification.isSupported())
                proxy.log({
                    type: 'warning', source: 'plugin', name: this.pluginName,
                    message: useKorean ? '현재 사용하고 계신 운영체제에서는 푸쉬 알람을 지원하지 않습니다.' : 'Your operating system does not support notifications.'
                });
        })

        app.on('will-quit', () => {
            // if (config.Config.Plugins[this.pluginName].deleteFileOnQuit) {
            //     fs.rmSync(logPath, { recursive: true });
            //     fs.mkdirSync(logPath);
            // }
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

        proxy.on('BattleDungeonStart', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {

            }
        });

        proxy.on('BattleDungeonResult_V2', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2)
                    this.failRun(proxy, config, req.dungeon_id, req.stage_id, req.clear_time);
                else {
                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10)
                        this.completeRun(proxy, config, req.dungeon_id, req.stage_id, req.clear_time);
                }
            }
        });

        proxy.on('BattleScenarioStart', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {

            }
        });

        proxy.on('BattleScenarioResult', (req, res) => {
            if (config.Config.Plugins[this.pluginName].enabled) {
                if (req.win_lose === 2)
                    this.failRun(proxy, config, req.dungeon_id, req.stage_id, req.clear_time);
                else {
                    clearTimes.push(req.clear_time);
                    if (req.auto_repeat === 10)
                        this.completeRun(proxy, config, req.dungeon_id, req.stage_id, req.clear_time);
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
    completeRun(proxy, config, dungeonId, stageId) {
        const clearCount = clearTimes.length,
            soundDelay = parseInt(config.Config.Plugins[this.pluginName].soundDelay) ?? DEFAULT_DELAY,
            soundVolume = parseInt(config.Config.Plugins[this.pluginName].soundVolume) ?? 5;
        var averageClearTime = 0;

        soundDelay = Math.max(0, Math.min(soundDelay, 60000));
        soundVolume = Math.max(0, Math.min(soundVolume, 10));

        clearTimes.forEach(clearTime => {
            averageClearTime += clearTime;
        });
        averageClearTime /= clearCount * 1000;
        clearTimes = [];

        notification = new Notification({
            title: useKorean ? '룬손실!' : 'Run Complete!',
            body: useKorean ? `연속전투가 종료되었습니다.\n평균 클리어 타임: ${averageClearTime}초` : `Repeat Battle has been stopped.\nAvg. Clear Time: ${averageClearTime}s`,
            silent: true,
            icon: ICON_PATH,
            timeoutType: 'never'
        });

        setTimeout(() => {
            proxy.log({
                type: 'success', source: 'plugin', name: this.pluginName,
                message: `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/c${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                ${useKorean ? `연속전투가 종료되었습니다.<br>평균 클리어 타임: ${averageClearTime}초` : `Repeat Battle has been stopped.\nAvg. Clear Time: ${averageClearTime}s`}`
            });

            notification.show();
            notification.on('click', () => {
                notification.close();
            });
        }, soundDelay);
    },
    failRun(proxy, config, dungeonId, stageId) {
        const clearCount = clearTimes.length,
            soundDelay = parseInt(config.Config.Plugins[this.pluginName].soundDelay) ?? DEFAULT_DELAY,
            soundVolume = parseInt(config.Config.Plugins[this.pluginName].soundVolume) ?? 5;
        var averageClearTime = 0;

        soundDelay = Math.max(0, Math.min(soundDelay, 60000));
        soundVolume = Math.max(0, Math.min(soundVolume, 10));

        clearTimes.forEach(clearTime => {
            averageClearTime += clearTime;
        });
        averageClearTime /= clearCount * 1000;
        clearTimes = [];

        notification = new Notification({
            title: useKorean ? '룬손실!' : 'Run Complete!',
            body: useKorean ? `전투 패배로 연속전투가 종료되었습니다.${clearCount ? `\n평균 클리어 타임: ${averageClearTime}초` : ''}` : `Repeat Battle has been completed.${clearCount ? `\nAvg. Clear Time: ${averageClearTime}s` : ''}`,
            silent: true,
            icon: ICON_PATH,
            timeoutType: 'never'
        });

        setTimeout(() => {
            proxy.log({
                type: 'warning', source: 'plugin', name: this.pluginName,
                message: `${soundVolume ? `<audio class="asd" src="${path.join(__dirname, `/assets/sounds/f${soundVolume}.mp3`)}" autoplay></audio>` : ''}
                ${useKorean ? `전투 패배로 연속전투가 종료되었습니다.${clearCount ? `\n평균 클리어 타임: ${averageClearTime}초` : ''}` : `Repeat Battle has been completed.${clearCount ? `\nAvg. Clear Time: ${averageClearTime}s` : ''}`}`
            });

            notification.show();
            notification.on('click', () => {
                notification.close();
            });
        }, soundDelay);
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
            default: // Secret Dungeon
                return 5;
        }
    },
    getReport() {
        return '123';
    },
    initPlugin(proxy, config) {
        this.checkVersion(proxy).then(res => {
            if (res.status === 200)
                res.text().then(version => {
                    const isLatest = version == 'latest';

                    if (config.Config.Plugins[this.pluginName].enabled)
                        proxy.log({
                            type: isLatest ? 'success' : 'warning', source: 'plugin', name: this.pluginName,
                            message: `${isLatest ?
                                '✔️ ' + (useKorean ? '최신 버전을 사용중입니다.' : 'You are using the latest version.') :
                                '❌ ' + (useKorean ? '구버전을 사용중입니다.' : 'You are not up to date with the latest plugin.')}
                                <br><br>${this.getReport()}`
                        });
                });
            else
                if (config.Config.Plugins[this.pluginName].enabled)
                    proxy.log({
                        type: 'error', source: 'plugin', name: this.pluginName,
                        message: `${'❌ ' + (useKorean ? '버전 확인에 실패하였습니다.' : 'Unsuccessful retrieving plugin version.')}
                        <br><br>${this.getReport()}`
                    });
        });
    },
    saveConfig(config) {
        fs.writeFile(CONFIG_PATH, JSON.stringify(config), { flag: 'w' }, error => {
            if (error)
                proxy.log({
                    type: 'error', source: 'plugin', name: this.pluginName,
                    message: `${useKorean ? '플러그인 파일을 저장하는데 실패하였습니다.' : 'Failed to save plugin config.'}<br>${error}`
                });
        });
    }
};