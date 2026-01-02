const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

const colors = {
    reset: "\u001b[0m", bright: "\u001b[1m", green: "\u001b[32m",
    cyan: "\u001b[36m", magenta: "\u001b[35m", yellow: "\u001b[33m",
    red: "\u001b[31m", gray: "\u001b[90m", bgBlue: "\u001b[44m",
    black: "\u001b[30m", white: "\u001b[37m"
};

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const bots = {};
let focusedBot = null;
let webhookActive = false;
let messageQueue = [];
let queueTimeout = null;
const AGGREGATOR_WAIT = 1000;
const AUTO_QUEUE_COMMAND = config.botSettings.autoQueueCommand || '/queue donutsmp';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function getTimestamp() {
    const now = new Date();
    return colors.gray + '[' + now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0') + ']' + colors.reset + ' ';
}

function log(message) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(getTimestamp() + message);
    updatePrompt();
}

function updatePrompt() {
    const prefix = focusedBot ? colors.magenta + focusedBot + colors.reset : colors.cyan + 'ALL' + colors.reset;
    rl.setPrompt(prefix + ' ' + colors.bright + '> ' + colors.reset);
    rl.prompt(true);
}

function stripColors(text) {
    if (!text) return '';
    let str = typeof text === 'string' ? text : (text.text || String(text));
    return str.replace(/§[0-9a-fk-or]/gi, '').trim();
}

function sendStatusWebhook(botName, status, details, color) {
    if (!config.webhook.url) return;
    const userId = config.webhook.discordUserId;
    const mention = userId ? '<@' + userId + '>' : '';
    const data = JSON.stringify({
        content: mention,
        embeds: [{
            title: '🤖 Bot Event: ' + botName,
            description: '**Status:** ' + status + '\n' + details,
            color: color,
            timestamp: new Date()
        }]
    });
    const url = new URL(config.webhook.url);
    const req = https.request({ 
        hostname: url.hostname, 
        path: url.pathname, 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' } 
    });
    req.write(data); 
    req.end();
}

function sendStatsWebhook(botName, balance, shards) {
    if (!config.webhook.url || !webhookActive) return;
    const data = JSON.stringify({
        embeds: [{
            title: '💰 Status: ' + botName, 
            color: 3447003,
            fields: [
                { name: "Balance", value: '`' + balance + '`', inline: true }, 
                { name: "Shards", value: '`' + shards + '`', inline: true }
            ],
            timestamp: new Date()
        }]
    });
    const url = new URL(config.webhook.url);
    const req = https.request({ 
        hostname: url.hostname, 
        path: url.pathname, 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' } 
    });
    req.write(data); 
    req.end();
}

function logMessage(name, msg) {
    messageQueue.push({ name, msg });
    if (!queueTimeout) queueTimeout = setTimeout(processQueue, AGGREGATOR_WAIT);
}

function processQueue() {
    const groups = {};
    messageQueue.forEach(function(item) { 
        if (!groups[item.msg]) groups[item.msg] = []; 
        groups[item.msg].push(item.name); 
    });
    Object.keys(groups).forEach(function(msg) {
        const owners = groups[msg];
        let logLine = (owners.length > 1) ? colors.cyan + '<' + owners.length + ' Bots>' + colors.reset + ' ' + msg : colors.magenta + '<' + owners[0] + '>' + colors.reset + ' ' + msg;
        log(logLine);
    });
    messageQueue = []; 
    queueTimeout = null;
}

function renderCLI(bot, isGui) {
    const window = isGui ? bot.currentWindow : bot.inventory;
    if (!window) return log(colors.red + 'No window open.' + colors.reset);
    const title = stripColors(window.title || (isGui ? "Container" : "Inventory"));
    let output = '\n' + colors.bgBlue + colors.white + '  ' + title.toUpperCase() + ' - ' + bot.username + '  ' + colors.reset + '\n';

    const formatSlot = function(i) {
        const item = window.slots[i];
        const slotId = i.toString().padStart(2, '0');
        if (item) {
            const displayName = item.displayName ? stripColors(item.displayName) : item.name.replace('minecraft:', '').replace(/_/g, ' ');
            const actualName = item.name.replace('minecraft:', '');
            
            const hasCustomName = item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value.Name;
            
            if (hasCustomName) {
                return colors.cyan + slotId + '.' + colors.reset + ' ' + 
                       colors.bright + colors.yellow + displayName + colors.reset + 
                       ' ' + colors.gray + '[' + actualName + ']' + colors.reset + 
                       ' (' + colors.bright + item.count + colors.reset + ')';
            } else {
                return colors.cyan + slotId + '.' + colors.reset + ' ' + 
                       colors.green + displayName + colors.reset + 
                       ' ' + colors.gray + '(' + actualName + ')' + colors.reset + 
                       ' (' + colors.bright + item.count + colors.reset + ')';
            }
        }
        return colors.gray + slotId + '. --' + colors.reset;
    };

    if (!isGui) {
        output += colors.yellow + '---- Equipment ----' + colors.reset + '\n';
        [5, 6, 7, 8, 45].forEach(function(id) { output += formatSlot(id) + "\n"; });
        output += '\n' + colors.yellow + '---- Main Inventory (Occupied) ----' + colors.reset + '\n';
        for (let i = 9; i <= 35; i++) { if (window.slots[i]) output += formatSlot(i) + '\n'; }
        output += '\n' + colors.yellow + '---- Hotbar ----' + colors.reset + '\n';
        for (let i = 36; i <= 44; i++) { output += formatSlot(i) + '\n'; }
        
        output += '\n' + colors.gray + '┌──────── GUIDE ────────┐\n';
        output += '│ Armor: 05-08 | Off: 45 │\n';
        output += '│ Main:  09-35 | Bar: 36 │\n';
        output += '└────────────────────────┘' + colors.reset + '\n';
    } else {
        output += colors.yellow + '---- Container Contents ----' + colors.reset + '\n';
        for (let i = 0; i < window.slots.length; i++) { 
            if (window.slots[i]) output += formatSlot(i) + '\n'; 
        }
    }
    log(output);
}

function triggerStatsCheck(bot) {
    if (!bot.spawned) return;
    bot.chat('/balance');
    setTimeout(function() { 
        if (bot.spawned) bot.chat('/shard balance'); 
    }, 3000);
    setTimeout(function() { 
        if (webhookActive && bot.spawned) sendStatsWebhook(bot.username, bot.stats.balance, bot.stats.shards); 
    }, 12000);
}

function antiAFK(bot) {
    if (!bot.spawned) return;
    const actions = [
        function() { bot.setControlState('jump', true); setTimeout(function() { bot.setControlState('jump', false); }, 100); },
        function() { bot.look(bot.entity.yaw + Math.PI / 4, 0); },
        function() { bot.activateItem(); setTimeout(function() { bot.deactivateItem(); }, 100); }
    ];
    actions[Math.floor(Math.random() * actions.length)]();
}

function findAndEquipArmor(bot) {
    if (!bot.spawned) return;
    const armorSlots = {
        helmet: 5,
        chestplate: 6,
        leggings: 7,
        boots: 8
    };
    
    Object.keys(armorSlots).forEach(function(type) {
        const slot = armorSlots[type];
        if (!bot.inventory.slots[slot]) {
            const armor = bot.inventory.items().find(function(item) {
                return item.name.includes(type);
            });
            if (armor) {
                bot.equip(armor, 'head').catch(function() {});
            }
        }
    });
}

function organizeInventory(bot) {
    if (!bot.spawned) return;
    log(colors.yellow + '[⚙] ' + bot.username + ' organizing inventory...' + colors.reset);
    
    const itemGroups = {};
    bot.inventory.items().forEach(function(item) {
        if (!itemGroups[item.name]) itemGroups[item.name] = [];
        itemGroups[item.name].push(item);
    });
    
    Object.keys(itemGroups).forEach(function(itemName) {
        const items = itemGroups[itemName];
        if (items.length > 1) {
            for (let i = 1; i < items.length; i++) {
                bot.clickWindow(items[i].slot, 0, 0).catch(function() {});
            }
        }
    });
}

function autoRespawn(bot) {
    bot.on('death', function() {
        log(colors.red + '[☠] ' + bot.username + ' died! Respawning...' + colors.reset);
        sendStatusWebhook(bot.username, 'Died ☠️', 'Bot died and is respawning...', 15158332);
        setTimeout(function() {
            bot.chat('/spawn');
        }, 2000);
    });
}

function trackPlaytime(bot) {
    bot.joinTime = Date.now();
    setInterval(function() {
        if (bot.spawned && bot.fullyJoined) {
            const playtime = Math.floor((Date.now() - bot.joinTime) / 1000 / 60);
            if (playtime > 0 && playtime % 60 === 0) {
                log(colors.cyan + '[⏰] ' + bot.username + ' playtime: ' + playtime + ' minutes' + colors.reset);
            }
        }
    }, 60000);
}

function autoAcceptTeleport(bot) {
    const masterName = config.botSettings.masterName || '';
    
    bot.on('messagestr', function(msg) {
        const clean = stripColors(msg);

        const tpaHereMatch = clean.match(/^(\w+)\s+sent you a tpahere request/i);
        if (tpaHereMatch) {
            const playerName = tpaHereMatch[1];
            
            if (masterName && playerName !== masterName) {
                log(colors.yellow + '[!] ' + bot.username + ' ignored TPAHere from ' + playerName + ' (not master)' + colors.reset);
                return;
            }
            
            log(colors.cyan + '[→] ' + bot.username + ' accepting TPAHere from ' + playerName + '...' + colors.reset);
            
            setTimeout(function() {
                bot.chat('/tpaccept ' + playerName);
            }, 500);
            
            const windowListener = function(window) {
                setTimeout(function() {
                    if (bot.currentWindow) {
                        for (let i = 0; i < bot.currentWindow.slots.length; i++) {
                            const item = bot.currentWindow.slots[i];
                            if (item && (item.name === 'minecraft:lime_stained_glass_pane' || item.name.includes('lime_stained_glass'))) {
                                bot.clickWindow(i, 0, 0).then(function() {
                                    log(colors.green + '[✓✓] ' + bot.username + ' successfully teleported to ' + playerName + '!' + colors.reset);
                                    bot.removeListener('windowOpen', windowListener);
                                }).catch(function(err) {
                                    log(colors.red + '[✗] ' + bot.username + ' failed to click teleport confirmation: ' + err.message + colors.reset);
                                });
                                return;
                            }
                        }
                        log(colors.yellow + '[!] ' + bot.username + ' could not find lime glass pane in window' + colors.reset);
                    }
                }, 500);
            };
            
        
        const tpaMatch = clean.match(/^(\w+)\s+sent you a tpa request/i);
        if (tpaMatch) {
            const playerName = tpaMatch[1];
            
            if (masterName && playerName !== masterName) {
                log(colors.yellow + '[!] ' + bot.username + ' ignored TPA from ' + playerName + ' (not master)' + colors.reset);
                return;
            }
            
            log(colors.cyan + '[→] ' + bot.username + ' accepting TPA from ' + playerName + '...' + colors.reset);
            
            setTimeout(function() {
                bot.chat('/tpaccept ' + playerName);
            }, 500);
            
            const windowListener = function(window) {
                setTimeout(function() {
                    if (bot.currentWindow) {
                        for (let i = 0; i < bot.currentWindow.slots.length; i++) {
                            const item = bot.currentWindow.slots[i];
                            if (item && (item.name === 'minecraft:lime_stained_glass_pane' || item.name.includes('lime_stained_glass'))) {
                                bot.clickWindow(i, 0, 0).then(function() {
                                    log(colors.green + '[✓✓] ' + bot.username + ' successfully teleported to ' + playerName + '!' + colors.reset);
                                    bot.removeListener('windowOpen', windowListener);
                                }).catch(function(err) {
                                    log(colors.red + '[✗] ' + bot.username + ' failed to click teleport confirmation: ' + err.message + colors.reset);
                                });
                                return;
                            }
                        }
                        log(colors.yellow + '[!] ' + bot.username + ' could not find lime glass pane in window' + colors.reset);
                    }
                }, 500);
            };
            
            bot.once('windowOpen', windowListener);
            
            setTimeout(function() {
                bot.removeListener('windowOpen', windowListener);
            }, 10000);
            
            return;
        }
        
        if (clean.includes('has requested to teleport') || clean.includes('/tpaccept')) {
            if (masterName) {
                if (clean.includes(masterName)) {
                    setTimeout(function() {
                        bot.chat('/tpaccept');
                        log(colors.green + '[✓] ' + bot.username + ' accepted teleport from master: ' + masterName + colors.reset);
                    }, 1000);
                } else {
                    log(colors.yellow + '[!] ' + bot.username + ' ignored teleport request (not from master)' + colors.reset);
                }
            } else {
                setTimeout(function() {
                    bot.chat('/tpaccept');
                    log(colors.green + '[✓] ' + bot.username + ' accepted teleport request' + colors.reset);
                }, 1000);
            }
        }
    });
}

function createBot(name) {
    const bot = mineflayer.createBot({ 
        host: config.server.host, 
        port: config.server.port, 
        version: config.server.version, 
        username: name, 
        auth: 'offline', 
        hideErrors: true 
    });
    
    bot.stats = { balance: '$0', shards: '0' };
    bot.loginAttempted = false;
    bot.queueJoined = false;
    bot.fullyJoined = false;
    
    autoRespawn(bot);
    trackPlaytime(bot);
    if (config.botSettings.autoAcceptTeleport) autoAcceptTeleport(bot);

    bot.on('spawn', function() {
        bot.spawned = true;
        
        if (!bot.fullyJoined) {
            log(colors.green + '[+] ' + name + ' connected.' + colors.reset);
            sendStatusWebhook(name, 'Connected ✅', 'Bot has spawned successfully.', 3066993);
            
        if (!bot.loginAttempted) {
                bot.loginAttempted = true;
                setTimeout(function() {
                    if (bot.spawned) {
                        log(colors.yellow + '[!] ' + name + ' attempting auto-login...' + colors.reset);
                        bot.chat('/login ' + config.botSettings.password);
                    }
                }, 3000);
            }
        }
        
        if (bot.checkTask) clearInterval(bot.checkTask);
        bot.checkTask = setInterval(function() { 
            if (webhookActive) triggerStatsCheck(bot); 
        }, config.webhook.delayMs);
    });

    bot.on('messagestr', function(msg) {
        const clean = stripColors(msg);
        const lower = clean.toLowerCase();
        
        if (clean.indexOf('has $') !== -1) { 
            const m = clean.match(/\$[0-9.,]+[KMB]?/); 
            if (m) bot.stats.balance = m[0]; 
        }
        if (clean.indexOf('current balance is') !== -1) { 
            const m = clean.match(/\d+(?:\.\d+)?[KMB]?/); 
            if (m) bot.stats.shards = m[0]; 
        }
        if (!bot.loginAttempted && (
            clean.indexOf('You still do not have an email address assigned to your account') !== -1 ||
            clean.indexOf('You still do not have second factor enabled on your account') !== -1 ||
            clean.indexOf('/changemailaddress') !== -1 ||
            clean.indexOf('/requestsecondfactor') !== -1
        )) {
            bot.loginAttempted = true;
            log(colors.green + '[✓] ' + name + ' logged in successfully!' + colors.reset);
        }
        
        if (bot.loginAttempted && !bot.queueJoined && (
            clean.indexOf('You still do not have an email address assigned to your account') !== -1 ||
            clean.indexOf('You still do not have second factor enabled on your account') !== -1 ||
            clean.indexOf('/changemailaddress') !== -1 ||
            clean.indexOf('/requestsecondfactor') !== -1
        )) {
            if (config.botSettings.autoQueueCommand) {
                setTimeout(function() {
                    if (!bot.queueJoined) {
                        bot.queueJoined = true;
                        bot.chat(AUTO_QUEUE_COMMAND);
                        log(colors.cyan + '[→] ' + name + ' auto-joining queue: ' + AUTO_QUEUE_COMMAND + colors.reset);
                    }
                }, 2000);
            }
        }
        
        if (lower.indexOf('position in queue') !== -1) {
            log(colors.green + '[✓] ' + name + ' in queue!' + colors.reset);
        }
        
        if ((lower.indexOf('welcome to') !== -1 || lower.indexOf('joined the game') !== -1 || lower.indexOf('sending you to donutsmp now..') !== -1) && !bot.fullyJoined) {
            bot.fullyJoined = true;
            log(colors.green + '[✓✓] ' + name + ' fully joined the game!' + colors.reset);
        }
        
        logMessage(name, clean);
    });

    bot.on('windowOpen', function() { 
        if (!focusedBot || focusedBot === name) renderCLI(bot, true); 
    });

    bot.on('end', function() {
        bot.spawned = false;
        const wasFullyJoined = bot.fullyJoined;
        bot.fullyJoined = false;
        
        log(colors.red + '[-] ' + name + ' disconnected. Reconnecting...' + colors.reset);
        
        if (wasFullyJoined) {
            sendStatusWebhook(name, 'Disconnected ❌', 'Bot lost connection. Attempting to reconnect...', 15158332);
        }
        
        clearInterval(bot.checkTask);
        setTimeout(function() {
            log(colors.yellow + '[↻] ' + name + ' reconnecting...' + colors.reset);
            sendStatusWebhook(name, 'Reconnecting 🔄', 'Bot is attempting to reconnect...', 16776960);
            createBot(name);
        }, 10000);
    });

    bots[name] = bot;
}

config.botSettings.usernames.forEach(function(name, i) { 
    setTimeout(function() { createBot(name); }, i * config.botSettings.joinDelay); 
});
updatePrompt();

rl.on('line', function(line) {
    const input = line.trim();
    if (!input) return updatePrompt();
    
    if (input.charAt(0) === '.') {
        const args = input.slice(1).split(' ');
        const cmd = args[0].toLowerCase();
        const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
        
        switch (cmd) {
            case 'control':
                if (!args[1]) {
                    focusedBot = null;
                    log(colors.cyan + 'Controlling ALL bots.' + colors.reset);
                } else {
                    const botName = args[1];
                    if (bots[botName]) {
                        focusedBot = botName;
                        log(colors.magenta + 'Now controlling: ' + botName + colors.reset);
                    } else {
                        log(colors.red + 'Bot "' + botName + '" not found. Available: ' + Object.keys(bots).join(', ') + colors.reset);
                    }
                }
                break;
                
            case 'list':
                log(colors.cyan + 'Connected bots: ' + Object.keys(bots).join(', ') + colors.reset);
                break;
                
            case 'startwebhook': 
                webhookActive = true; 
                log(colors.green + 'Webhook started.' + colors.reset); 
                Object.values(bots).forEach(function(b) { 
                    if (b.spawned) triggerStatsCheck(b); 
                }); 
                break;
                
            case 'stopwebhook': 
                webhookActive = false; 
                log(colors.red + 'Webhook stopped.' + colors.reset); 
                break;
                
            case 'inv': 
                if (targets[0]) renderCLI(targets[0], false); 
                break;
                
            case 'gui': 
                if (targets[0]) renderCLI(targets[0], true); 
                break;
                
            case 'click': 
                if (!args[1]) {
                    log(colors.red + 'Usage: .click <slot|itemname>' + colors.reset);
                    break;
                }
                
                targets.forEach(function(b) { 
                    if (b.currentWindow) {
                        if (!isNaN(args[1])) {
                            b.clickWindow(parseInt(args[1]), 0, 0);
                            log(colors.green + '[✓] ' + b.username + ' clicked slot ' + args[1] + colors.reset);
                        } else {
                            const searchName = args.slice(1).join(' ').toLowerCase();
                            let found = false;
                            
                            for (let i = 0; i < b.currentWindow.slots.length; i++) {
                                const item = b.currentWindow.slots[i];
                                if (item) {
                                    const displayName = item.displayName ? stripColors(item.displayName).toLowerCase() : '';
                                    const itemName = item.name.replace('minecraft:', '').replace(/_/g, ' ').toLowerCase();
                                    
                                    if (displayName.includes(searchName) || itemName.includes(searchName)) {
                                        b.clickWindow(i, 0, 0);
                                        log(colors.green + '[✓] ' + b.username + ' clicked "' + (displayName || itemName) + '" at slot ' + i + colors.reset);
                                        found = true;
                                        break;
                                    }
                                }
                            }
                            
                            if (!found) {
                                log(colors.yellow + '[!] ' + b.username + ' could not find item: ' + searchName + colors.reset);
                            }
                        }
                    } else {
                        log(colors.red + '[!] ' + b.username + ' has no window open' + colors.reset);
                    }
                }); 
                break;
                
            case 'drop': 
                if (!args[1]) {
                    log(colors.red + 'Usage: .drop <slot|itemname>' + colors.reset);
                    break;
                }
                
                targets.forEach(async function(b) {
                    if (!isNaN(args[1])) {
                        const item = b.inventory.slots[parseInt(args[1])];
                        if (item) {
                            await b.tossStack(item);
                            log(colors.green + '[✓] ' + b.username + ' dropped item from slot ' + args[1] + colors.reset);
                        } else {
                            log(colors.yellow + '[!] ' + b.username + ' has no item in slot ' + args[1] + colors.reset);
                        }
                    } else {
                        const searchName = args.slice(1).join(' ').toLowerCase();
                        const items = b.inventory.items();
                        let found = false;
                        
                        for (const item of items) {
                            const displayName = item.displayName ? stripColors(item.displayName).toLowerCase() : '';
                            const itemName = item.name.replace('minecraft:', '').replace(/_/g, ' ').toLowerCase();
                            
                            if (displayName.includes(searchName) || itemName.includes(searchName)) {
                                await b.tossStack(item);
                                log(colors.green + '[✓] ' + b.username + ' dropped "' + (displayName || itemName) + '"' + colors.reset);
                                found = true;
                                break;
                            }
                        }
                        
                        if (!found) {
                            log(colors.yellow + '[!] ' + b.username + ' could not find item: ' + searchName + colors.reset);
                        }
                    }
                }); 
                break;
                
            case 'dropall': 
                targets.forEach(async function(b) { 
                    for (const i of b.inventory.items()) await b.tossStack(i); 
                }); 
                break;
                
            case 'login':
                targets.forEach(function(b) {
                    b.chat('/login ' + config.botSettings.password);
                    log(colors.yellow + '[!] ' + b.username + ' attempting login...' + colors.reset);
                });
                break;
            
            case 'antiafk':
                if (!args[1] || args[1] === 'start') {
                    targets.forEach(function(b) {
                        if (b.afkInterval) clearInterval(b.afkInterval);
                        b.afkInterval = setInterval(function() { antiAFK(b); }, 30000);
                        log(colors.green + '[✓] Anti-AFK started for ' + b.username + colors.reset);
                    });
                } else if (args[1] === 'stop') {
                    targets.forEach(function(b) {
                        if (b.afkInterval) {
                            clearInterval(b.afkInterval);
                            b.afkInterval = null;
                            log(colors.red + '[✗] Anti-AFK stopped for ' + b.username + colors.reset);
                        }
                    });
                }
                break;
            
            case 'armor':
                targets.forEach(function(b) { findAndEquipArmor(b); });
                break;
            
            case 'organize':
                targets.forEach(function(b) { organizeInventory(b); });
                break;
            
            case 'stats':
                targets.forEach(function(b) {
                    log(colors.cyan + b.username + ' Stats:' + colors.reset + 
                        '\n  Balance: ' + colors.green + b.stats.balance + colors.reset +
                        '\n  Shards: ' + colors.yellow + b.stats.shards + colors.reset +
                        '\n  Food: ' + colors.magenta + (b.food || 'N/A') + colors.reset +
                        '\n  Health: ' + colors.red + (b.health || 'N/A') + colors.reset);
                });
                break;
                
            case 'help':
            case 'h':
                log('\n' + colors.bright + 'Available Commands:' + colors.reset + '\n' +
                    colors.yellow + '═══ Basic Control ═══' + colors.reset + '\n' +
                    '  ' + colors.cyan + '.control <name>' + colors.reset + ' - Control specific bot (or .control for ALL)\n' +
                    '  ' + colors.cyan + '.list' + colors.reset + ' - Show all connected bots\n' +
                    '  ' + colors.cyan + '.stats' + colors.reset + ' - Show bot stats (balance, health, food)\n' +
                    '\n' + colors.yellow + '═══ Inventory Management ═══' + colors.reset + '\n' +
                    '  ' + colors.cyan + '.inv' + colors.reset + ' - Show inventory\n' +
                    '  ' + colors.cyan + '.gui' + colors.reset + ' - Show current GUI window\n' +
                    '  ' + colors.cyan + '.click <slot|name>' + colors.reset + ' - Click slot number OR item by name\n' +
                    '  ' + colors.cyan + '.drop <slot|name>' + colors.reset + ' - Drop item by slot number OR name\n' +
                    '  ' + colors.cyan + '.dropall' + colors.reset + ' - Drop all items\n' +
                    '  ' + colors.cyan + '.organize' + colors.reset + ' - Organize and stack items\n' +
                    '  ' + colors.cyan + '.armor' + colors.reset + ' - Auto-equip armor\n' +
                    '\n' + colors.yellow + '═══ Automation ═══' + colors.reset + '\n' +
                    '  ' + colors.cyan + '.antiafk start/stop' + colors.reset + ' - Toggle anti-AFK movements\n' +
                    '\n' + colors.yellow + '═══ Server Management ═══' + colors.reset + '\n' +
                    '  ' + colors.cyan + '.login' + colors.reset + ' - Manually trigger login\n' +
                    '  ' + colors.cyan + '.startwebhook' + colors.reset + ' - Start webhook logging\n' +
                    '  ' + colors.cyan + '.stopwebhook' + colors.reset + ' - Stop webhook logging\n' +
                    '  ' + colors.cyan + '.quit / .q' + colors.reset + ' - Exit program\n\n' +
                    colors.gray + 'Auto-features: Login (3s after spawn), Queue, Respawn\n' +
                    'Master teleport: Set "masterName" in config.json\n' +
                    'Configure in config.json' + colors.reset);
                break;
                
            case 'quit':
            case 'q':
                log(colors.red + 'Shutting down all bots...' + colors.reset);
                process.exit();
                
            default:
                log(colors.red + 'Unknown command. Type .help for commands.' + colors.reset);
        }
    } else {
        const targets = focusedBot ? [bots[focusedBot]] : Object.values
        targets.forEach(function(b) { 
            if (b.spawned) b.chat(input); 
        });
    }
    updatePrompt();
});
