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
const AGGREGATOR_WAIT = 500;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- UI & LOGGING ---
function getTimestamp() {
    const now = new Date();
    return `${colors.gray}[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]${colors.reset} `;
}

function log(message) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(getTimestamp() + message);
    updatePrompt();
}

function updatePrompt() {
    const prefix = focusedBot ? `${colors.magenta}${focusedBot}${colors.reset}` : `${colors.cyan}ALL${colors.reset}`;
    rl.setPrompt(`${prefix} ${colors.bright}> ${colors.reset}`);
    rl.prompt(true);
}

function stripColors(text) {
    if (!text) return '';
    let str = typeof text === 'string' ? text : (text.text || String(text));
    return str.replace(/§[0-9a-fk-or]/gi, '').trim();
}

// --- WEBHOOK LOGGING ---
function sendStatusWebhook(botName, status, details = "", color = 3447003) {
    if (!config.webhook.url) return;
    const data = JSON.stringify({
        embeds: [{
            title: `🤖 Bot Event: ${botName}`,
            description: `**Status:** ${status}\n${details}`,
            color: color,
            timestamp: new Date()
        }]
    });
    const url = new URL(config.webhook.url);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.write(data); req.end();
}

function sendStatsWebhook(botName, balance, shards) {
    if (!config.webhook.url || !webhookActive) return;
    const data = JSON.stringify({
        embeds: [{
            title: `💰 Status: ${botName}`, color: 3447003,
            fields: [{ name: "Balance", value: `\`${balance}\``, inline: true }, { name: "Shards", value: `\`${shards}\``, inline: true }],
            timestamp: new Date()
        }]
    });
    const url = new URL(config.webhook.url);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.write(data); req.end();
}

// --- MESSAGE AGGREGATOR ---
function logMessage(name, msg) {
    messageQueue.push({ name, msg });
    if (!queueTimeout) queueTimeout = setTimeout(processQueue, AGGREGATOR_WAIT);
}

function processQueue() {
    const groups = {};
    messageQueue.forEach(({ name, msg }) => { if (!groups[msg]) groups[msg] = []; groups[msg].push(name); });
    Object.keys(groups).forEach(msg => {
        const owners = groups[msg];
        let logLine = (owners.length > 1) ? `${colors.cyan}<${owners.length} Bots>${colors.reset} ${msg}` : `${colors.magenta}<${owners[0]}>${colors.reset} ${msg}`;
        log(logLine);
    });
    messageQueue = []; queueTimeout = null;
}

// --- RENDERER (LIST + HELPER) ---
function renderCLI(bot, isGui = false) {
    const window = isGui ? bot.currentWindow : bot.inventory;
    if (!window) return log(`${colors.red}No window open.${colors.reset}`);
    const title = stripColors(window.title || (isGui ? "Container" : "Inventory"));
    let output = `\n${colors.bgBlue}${colors.white}  ${title.toUpperCase()} - ${bot.username}  ${colors.reset}\n`;

    const formatSlot = (i) => {
        const item = window.slots[i];
        const slotId = i.toString().padStart(2, '0');
        if (item) return `${colors.cyan}${slotId}.${colors.reset} ${colors.green}${stripColors(item.displayName)}${colors.reset} (${colors.bright}${item.count}${colors.reset})`;
        return `${colors.gray}${slotId}. --${colors.reset}`;
    };

    if (!isGui) {
        output += `${colors.yellow}---- Equipment ----${colors.reset}\n`;
        [5, 6, 7, 8, 45].forEach(id => output += formatSlot(id) + "\n");
        output += `\n${colors.yellow}---- Main Inventory (Occupied) ----${colors.reset}\n`;
        for (let i = 9; i <= 35; i++) { if (window.slots[i]) output += formatSlot(i) + "\n"; }
        output += `\n${colors.yellow}---- Hotbar ----${colors.reset}\n`;
        for (let i = 36; i <= 44; i++) { output += formatSlot(i) + "\n"; }
        
        output += `\n${colors.gray}┌──────── GUIDE ────────┐\n`;
        output += `│ Armor: 05-08 | Off: 45 │\n`;
        output += `│ Main:  09-35 | Bar: 36 │\n`;
        output += `└────────────────────────┘${colors.reset}\n`;
    } else {
        output += `${colors.yellow}---- Container Contents ----${colors.reset}\n`;
        for (let i = 0; i < window.slots.length; i++) { if (window.slots[i]) output += formatSlot(i) + "\n"; }
    }
    log(output);
}

// --- BOT CORE ---
function triggerStatsCheck(bot) {
    if (!bot.spawned) return;
    bot.chat('/balance');
    setTimeout(() => bot.spawned && bot.chat('/shard balance'), 3000);
    setTimeout(() => webhookActive && bot.spawned && sendStatsWebhook(bot.username, bot.stats.balance, bot.stats.shards), 12000);
}

function createBot(name) {
    const bot = mineflayer.createBot({ host: config.server.host, port: config.server.port, version: config.server.version, username: name, auth: 'offline', hideErrors: true });
    bot.stats = { balance: "$0", shards: "0" };
    bot.loginAttempted = false;
    bot.queueJoined = false;

    bot.on('spawn', () => {
        bot.spawned = true;
        bot.loginAttempted = false;
        bot.queueJoined = false;
        log(`${colors.green}[+] ${name} connected.${colors.reset}`);
        sendStatusWebhook(name, "Connected ✅", "Bot has spawned successfully.", 3066993);
        
        if (bot.checkTask) clearInterval(bot.checkTask);
        bot.checkTask = setInterval(() => { if (webhookActive) triggerStatsCheck(bot); }, config.webhook.delayMs);
    });

    bot.on('messagestr', (msg) => {
        const clean = stripColors(msg);
        const lower = clean.toLowerCase();
        
        // Balance tracking
        if (clean.includes('has $')) { const m = clean.match(/\$[0-9.,]+[KMB]?/); if (m) bot.stats.balance = m[0]; }
        if (clean.includes('current balance is')) { const m = clean.match(/\d+(?:\.\d+)?[KMB]?/); if (m) bot.stats.shards = m[0]; }
        
        // Auto-login detection - multiple patterns
        if (!bot.loginAttempted && (
            lower.includes('/login') || 
            lower.includes('please login') ||
            lower.includes('you are not logged in') ||
            lower.includes('authentication required')
        )) {
            bot.loginAttempted = true;
            log(`${colors.yellow}[!] ${name} attempting login...${colors.reset}`);
            setTimeout(() => {
                bot.chat(`/login ${config.botSettings.password}`);
            }, 1000);
        }
        
        // Login success detection
        if (bot.loginAttempted && !bot.queueJoined && (
            lower.includes('successfully logged in') ||
            lower.includes('you have logged in') ||
            lower.includes('if you do not want to login next time') ||
            lower.includes('/premium') ||
            lower.includes('/startsession')
        )) {
            log(`${colors.green}[✓] ${name} logged in successfully!${colors.reset}`);
            // Join queue after successful login
            setTimeout(() => {
                if (!bot.queueJoined) {
                    bot.queueJoined = true;
                    bot.chat('/queue donutsmp');
                    log(`${colors.cyan}[→] ${name} joining DonutSMP queue...${colors.reset}`);
                }
            }, 2000);
        }
        
        // Queue confirmation
        if (lower.includes('added to the queue') || lower.includes('position in queue')) {
            log(`${colors.green}[✓] ${name} in queue!${colors.reset}`);
        }
        
        logMessage(name, clean);
    });

    bot.on('windowOpen', () => { if (!focusedBot || focusedBot === name) renderCLI(bot, true); });

    bot.on('end', () => {
        bot.spawned = false;
        log(`${colors.red}[-] ${name} disconnected. Reconnecting...${colors.reset}`);
        sendStatusWebhook(name, "Disconnected ❌", "Bot lost connection. Attempting to reconnect...", 15158332);
        clearInterval(bot.checkTask);
        setTimeout(() => createBot(name), 10000);
    });

    bots[name] = bot;
}

// Startup
config.botSettings.usernames.forEach((name, i) => setTimeout(() => createBot(name), i * config.botSettings.joinDelay));
updatePrompt();

// Command Handler
rl.on('line', (line) => {
    const input = line.trim();
    if (!input) return updatePrompt();
    if (input.startsWith('.')) {
        const args = input.slice(1).split(' ');
        const cmd = args[0].toLowerCase();
        const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
        
        switch (cmd) {
            case 'c':
            case 'control':
                if (!args[1]) {
                    focusedBot = null;
                    log(`${colors.cyan}Controlling ALL bots.${colors.reset}`);
                } else {
                    const botName = args[1];
                    if (bots[botName]) {
                        focusedBot = botName;
                        log(`${colors.magenta}Now controlling: ${botName}${colors.reset}`);
                    } else {
                        log(`${colors.red}Bot "${botName}" not found. Available: ${Object.keys(bots).join(', ')}${colors.reset}`);
                    }
                }
                break;
                
            case 'list':
                log(`${colors.cyan}Connected bots: ${Object.keys(bots).join(', ')}${colors.reset}`);
                break;
                
            case 'startwebhook': 
                webhookActive = true; 
                log(`${colors.green}Webhook started.${colors.reset}`); 
                Object.values(bots).forEach(b => b.spawned && triggerStatsCheck(b)); 
                break;
                
            case 'stopwebhook': 
                webhookActive = false; 
                log(`${colors.red}Webhook stopped.${colors.reset}`); 
                break;
                
            case 'i':
            case 'inv': 
                if (targets[0]) renderCLI(targets[0], false); 
                break;
                
            case 'gui': 
                if (targets[0]) renderCLI(targets[0], true); 
                break;
                
            case 'click': 
                targets.forEach(b => { if (b.currentWindow) b.clickWindow(parseInt(args[1]), 0, 0); }); 
                break;
                
            case 'drop': 
                targets.forEach(async b => { const item = b.inventory.slots[parseInt(args[1])]; if (item) await b.tossStack(item); }); 
                break;
                
            case 'dropall': 
                targets.forEach(async b => { for (const i of b.inventory.items()) await b.tossStack(i); }); 
                break;
                
            case 'login':
                targets.forEach(b => {
                    b.chat(`/login ${config.botSettings.password}`);
                    log(`${colors.yellow}[!] ${b.username} attempting login...${colors.reset}`);
                });
                break;
                
            case 'help':
                log(`
${colors.bright}Available Commands:${colors.reset}
  ${colors.cyan}.control <name> / .c <name>${colors.reset} - Control specific bot (or .control for ALL)
  ${colors.cyan}.list${colors.reset} - Show all connected bots
  ${colors.cyan}.inv / .i${colors.reset} - Show inventory
  ${colors.cyan}.gui${colors.reset} - Show current GUI window
  ${colors.cyan}.click <slot>${colors.reset} - Click slot in GUI
  ${colors.cyan}.drop <slot>${colors.reset} - Drop item from slot
  ${colors.cyan}.dropall${colors.reset} - Drop all items
  ${colors.cyan}.login${colors.reset} - Manually trigger login
  ${colors.cyan}.startwebhook${colors.reset} - Start webhook logging
  ${colors.cyan}.stopwebhook${colors.reset} - Stop webhook logging
  ${colors.cyan}.quit${colors.reset} - Exit program
                `);
                break;
                
            case 'quit':
            case 'q':
                process.exit();
                
            default:
                log(`${colors.red}Unknown command. Type .help for commands.${colors.reset}`);
        }
    } else {
        const targets = focusedBot ? [bots[focusedBot]] : Object.values(bots);
        targets.forEach(b => b.spawned && b.chat(input));
    }
    updatePrompt();
});
