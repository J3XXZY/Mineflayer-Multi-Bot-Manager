# 🤖 Mineflayer Multi-Bot Manager

An advanced Minecraft bot manager designed for high-efficiency farming and monitoring on Discord. This tool allows you to control multiple accounts from a single terminal with smart automation features.

![Node.js](https://img.shields.io/badge/Node.js-v16+-green.svg)
![Mineflayer](https://img.shields.io/badge/Mineflayer-v4.0+-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux%20%7C%20Windows-orange.svg)

## ✨ Features

* **Grouped Logging:** Identical messages from multiple bots are merged into a single line (e.g., `<All> Hello (3)`) to prevent console spam.
* **Dynamic Command Prompt:** The terminal input shows which bot is currently focused (e.g., `J3XXZY >` or `ALL >`).
* **Discord Webhooks:** Automatically sends a formatted status report (Money & Shards) to your Discord server every 30 minutes.
* **Auto-GUI Detection:** Instantly renders Minecraft menus (chests/NPCs) in your console with slot IDs for manual interaction.
* **Smart Parsing:** Uses Regex to extract economy data like `$15.11K` and `429 Shard(s)`.
* **Remote UI Control:** Use `.score` to see the sidebar, `.gui` to see menus, and `.click <slot>` to interact remotely.
* **Persistent Connectivity:** Automated `/login`, anti-kick management, and auto-reconnect logic.

---

## 🚀 Installation

### 1. Requirements
* **Node.js** (v18 recommended)
* **NPM**

### 2. Setup
```bash
# Clone the repository
git clone [https://github.com/J3XXZY/Mineflayer-Multi-Bot-Manager.git](https://github.com/J3XXZY/Mineflayer-Multi-Bot-Manager.git)
cd Mineflayer-Multi-Bot-Manager

# Install dependencies
npm install mineflayer
