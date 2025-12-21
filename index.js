const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

const colors = {
    reset: "\u001b[0m", bright: "\u001b[1m", green: "\u001b[32m",
    cyan: "\u001b[36m", magenta: "\u001b[35m", yellow: "\u001b[33m",
    red: "\u001b[31m", gray: "\u001b[90m", bgBlue: "\u001b[44m"
};

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const bots = {};
let focusedBot = null;
let messageQueue = [];
let queueTimeout = null;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- PROMPT MANAGER ---
function updatePrompt() {
    const prefix = focusedBot ? `${colors.magenta}${focusedBot}${colors.reset}` : `${colors.cyan}ALL${colors.reset}`;
    rl.setPrompt(`${prefix} ${colors.bright}> ${colors.reset}`);
    rl.prompt(true);
}

function getTimestamp() {
    const now = new Date();
    return `${colors.gray}[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]${colors.reset} `;
}

function stripColors(text) {
    if (!text) return '';
    let str = typeof text === 'string' ? text : (text.text || String(text));
    return str.replace(/§[0-9a-fk-or]/gi, '').trim();
}

// --- LOGGING ---
function log(message) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(message);
    updatePrompt();
}

function logMessage(name, msg) {
    messageQueue.push({ name, msg });
    if (!queueTimeout) queueTimeout = setTimeout(processQueue, 100);
}

function processQueue() {
    const groups = {};
    messageQueue.forEach(({ name, msg }) => {
        if (!groups[msg]) groups[msg] = [];
        groups[msg].push(name);
    });

    Object.keys(groups).forEach(msg => {
        const owners = groups[msg];
        const timestamp = getTimestamp();
        let logLine = "";

        if (owners.length === config.botSettings.usernames.length && owners.length > 1) {
            logLine = `${colors.cyan}<All>${colors.reset} ${msg} ${colors.yellow}(${owners.length})${colors.reset}`;
        } else if (owners.length > 1) {
            logLine = `${colors.cyan}<${owners.length} Bots>${colors.reset} ${msg}`;
        } else {
            logLine = `${colors.magenta}<${owners[0]}>${colors.reset} ${msg}`;
        }
        log(timestamp + logLine);
    });

    messageQueue = [];
    queueTimeout = null;
}

// --- SCOREBOARD & GUI ---
function displayScoreboard(bot) {
    const sidebar = bot.scoreboard['1'] || bot.scoreboard['3'] || Object.values(bot.scoreboard)[0];
    if (!sidebar) return log(`${colors.red}No data for ${bot.username}${colors.reset}`);

    let output = `\n${colors.bgBlue}${colors.bright}  SCOREBOARD: ${bot.username}  ${colors.reset}\n`;
    const items = Object.values(sidebar.itemsMap).sort((a, b) => b.value - a.value);
    items.forEach(item => {
        let name = stripColors(item.displayName || item.name);
        const team = Object.values(bot.teams).find(t => t.players.includes(item.name));
        if (team) name = stripColors(team.prefix) + name + stripColors(team.suffix);
        if (name.length > 1) output += `${colors.cyan}${name.padEnd(28)}${colors.reset} ${colors.yellow}${item.value}${colors.reset}\n`;
    });
    log(output + "============================================\n");
}

function renderGui(bot, isAuto = false) {
    const window = bot.currentWindow || bot.inventory;
    if (!window) return;
    let title = "Inventory";
    try { title = stripColors(window.title); } catch(e) {}
    let output = `\n${colors.bgBlue}${colors.bright}  ${isAuto ? '[AUTO] ' : ''}GUI: ${bot.username} | ${title}  ${colors.reset}\n`;
    for (let i = 0; i < window.slots.length; i++) {
        const item = window.slots[i];
        let name = item ? stripColors(item.customName || item.displayName) : "---";
        output += `${colors.gray}[${colors.reset}${i.toString().padStart(2, '0')}:${item ? colors.green : colors.gray}${name.substring(0, 10).padEnd(10)}${colors.gray}]${colors.reset} `;
        if ((i + 1) % 9 === 0) output += "\n";
    }
    log(output + "============================================\n");
}

// --- WEBHOOK ---
function sendDiscordWebhook(botName, balance, shards) {
    if (!config.webhook.url) return;
    const data = JSON.stringify({
        content: `<@${config.webhook.discordUserId}>`,
        embeds: [{
            title: `💰 Status: ${botName}`, color: 3447003,
            fields: [{ name: "💵 Balance", value: `\`${balance}\``, inline: true }, { name: "✨ Shards", value: `\`${shards}\``, inline: true }],
            timestamp: new Date()
        }]
    });
    const url = new URL(config.webhook.url);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
        if (res.statusCode < 300) log(`${getTimestamp()}${colors.green}[WEBHOOK] Sent for ${botName}${colors.reset}`);
    });
    req.on('error', (e) => log(`${getTimestamp()}${colors.red}[WEBHOOK] Error: ${e.message}${colors.reset}`));
    req.write(data);
    req.end();
}

// --- BOT CORE ---
function createBot(name) {
    const bot = mineflayer.createBot({ host: config.server.host, port: config.server.port, version: config.server.version, username: name, auth: 'offline', hideErrors: true });
    bot.stats = { balance: "$0", shards: "0" };

    bot.on('windowOpen', () => { if (!focusedBot || focusedBot === name) renderGui(bot, true); });

    bot.on('spawn', () => {
        bot.spawned = true;
        log(`${getTimestamp()}${colors.green}[+] ${name} spawned.${colors.reset}`);
        if (!bot.checkTask) {
            bot.checkTask = setInterval(() => {
                if (bot.spawned) {
                    bot.chat('/balance');
                    setTimeout(() => bot.chat('/shard balance'), 3000);
                    setTimeout(() => sendDiscordWebhook(name, bot.stats.balance, bot.stats.shards), 10000);
                }
            }, config.webhook.delayMs);
        }
    });

    bot.on('messagestr', (msg) => {
        const clean = stripColors(msg);
        if (!clean) return;
        if (clean.includes('has $')) { const m = clean.match(/\$[0-9.,]+[KMB]?/); if (m) bot.stats.balance = m[0]; }
        if (clean.includes('current balance is')) { const m = clean.match(/\d+/); if (m) bot.stats.shards = m[0]; }
        if (clean.toLowerCase().includes('/login')) bot.chat(`/login ${config.botSettings.password}`);
        logMessage(name, clean);
    });

    bot.on('end', () => { bot.spawned = false; clearInterval(bot.checkTask); bot.checkTask = null; setTimeout(() => createBot(name), 10000); });
    bots[name] = bot;
}

// Start
config.botSettings.usernames.forEach((name, i) => setTimeout(() => createBot(name), i * config.botSettings.joinDelay));
updatePrompt();

// Input
rl.on('line', (line) => {
    const input = line.trim();
    if (!input) return updatePrompt();

    if (input.startsWith('.')) {
        const args = input.slice(1).split(' ');
        const cmd = args[0].toLowerCase();
        const currentBot = focusedBot ? bots[focusedBot] : Object.values(bots)[0];
        switch(cmd) {
            case 'control':
                focusedBot = bots[args[1]] ? args[1] : null;
                log(`${colors.yellow}Focus: ${focusedBot || "ALL"}${colors.reset}`);
                break;
            case 'score': if (currentBot) displayScoreboard(currentBot); break;
            case 'gui': if (currentBot) renderGui(currentBot); break;
            case 'click':
                const slot = parseInt(args[1]);
                const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
                targets.forEach(b => { if (b.currentWindow) b.clickWindow(slot, 0, 0); });
                break;
            case 'status':
                Object.keys(bots).forEach(n => log(`${colors.cyan}${n.padEnd(12)}${colors.reset} | Money: ${bots[n].stats.balance} | Shards: ${bots[n].stats.shards}`));
                break;
            case 'quit': process.exit();
        }
    } else {
        const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
        targets.forEach(b => b.spawned && b.chat(input));
    }
    updatePrompt();
});
