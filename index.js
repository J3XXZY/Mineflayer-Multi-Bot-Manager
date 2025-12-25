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
            const displayName = stripColors(item.displayName);
            const actualName = item.name;
            
            // Check if item has been renamed (displayName different from actual name)
            const isRenamed = displayName.toLowerCase() !== actualName.replace('minecraft:', '').replace(/_/g, ' ');
            
            if (isRenamed) {
                return colors.cyan + slotId + '.' + colors.reset + ' ' + 
                       colors.green + displayName + colors.reset + 
                       ' ' + colors.gray + '[' + actualName.replace('minecraft:', '') + ']' + colors.reset + 
                       ' (' + colors.bright + item.count + colors.reset + ')';
            } else {
                return colors.cyan + slotId + '.' + colors.reset + ' ' + 
                       colors.green + displayName + colors.reset + 
                       ' ' + colors.gray + '(' + actualName.replace('minecraft:', '') + ')' + colors.reset + 
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

    bot.on('spawn', function() {
        bot.spawned = true;
        bot.loginAttempted = false;
        bot.queueJoined = false;
        
        if (!bot.fullyJoined) {
            log(colors.green + '[+] ' + name + ' connected.' + colors.reset);
            sendStatusWebhook(name, 'Connected ✅', 'Bot has spawned successfully.', 3066993);
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
            lower.indexOf('/login') !== -1 || 
            lower.indexOf('please login') !== -1 ||
            lower.indexOf('you are not logged in') !== -1 ||
            lower.indexOf('authentication required') !== -1
        )) {
            bot.loginAttempted = true;
            log(colors.yellow + '[!] ' + name + ' attempting login...' + colors.reset);
            setTimeout(function() {
                bot.chat('/login ' + config.botSettings.password);
            }, 1000);
        }
        
        if (bot.loginAttempted && !bot.queueJoined && (
            lower.indexOf('successfully logged in') !== -1 ||
            lower.indexOf('you have logged in') !== -1 ||
            lower.indexOf('if you do not want to login next time') !== -1 ||
            lower.indexOf('/premium') !== -1 ||
            lower.indexOf('/startsession') !== -1
        )) {
            log(colors.green + '[✓] ' + name + ' logged in successfully!' + colors.reset);
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
        
        if (lower.indexOf('added to the queue') !== -1 || lower.indexOf('position in queue') !== -1) {
            log(colors.green + '[✓] ' + name + ' in queue!' + colors.reset);
        }
        
        if ((lower.indexOf('welcome to') !== -1 || lower.indexOf('joined the game') !== -1 || lower.indexOf('spawned in') !== -1) && !bot.fullyJoined) {
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
                targets.forEach(function(b) { 
                    if (b.currentWindow) b.clickWindow(parseInt(args[1]), 0, 0); 
                }); 
                break;
                
            case 'drop': 
                targets.forEach(async function(b) { 
                    const item = b.inventory.slots[parseInt(args[1])]; 
                    if (item) await b.tossStack(item); 
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
                
            case 'help':
            case 'h':
                log('\n' + colors.bright + 'Available Commands:' + colors.reset + '\n' +
                    '  ' + colors.cyan + '.control <n>' + colors.reset + ' - Control specific bot (or .control for ALL)\n' +
                    '  ' + colors.cyan + '.list' + colors.reset + ' - Show all connected bots\n' +
                    '  ' + colors.cyan + '.inv' + colors.reset + ' - Show inventory\n' +
                    '  ' + colors.cyan + '.gui' + colors.reset + ' - Show current GUI window\n' +
                    '  ' + colors.cyan + '.click <slot>' + colors.reset + ' - Click slot in GUI\n' +
                    '  ' + colors.cyan + '.drop <slot>' + colors.reset + ' - Drop item from slot\n' +
                    '  ' + colors.cyan + '.dropall' + colors.reset + ' - Drop all items\n' +
                    '  ' + colors.cyan + '.login' + colors.reset + ' - Manually trigger login\n' +
                    '  ' + colors.cyan + '.startwebhook' + colors.reset + ' - Start webhook logging\n' +
                    '  ' + colors.cyan + '.stopwebhook' + colors.reset + ' - Stop webhook logging\n' +
                    '  ' + colors.cyan + '.quit / .q' + colors.reset + ' - Exit program\n\n' +
                    colors.gray + 'Note: Auto-queue is configured in config.json' + colors.reset);
                break;
                
            case 'quit':
            case 'q':
                log(colors.red + 'Shutting down all bots...' + colors.reset);
                process.exit();
                
            default:
                log(colors.red + 'Unknown command. Type .help for commands.' + colors.reset);
        }
    } else {
        const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
        targets.forEach(function(b) { 
            if (b.spawned) b.chat(input); 
        });
    }
    updatePrompt();
});