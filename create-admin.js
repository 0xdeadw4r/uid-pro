require('dotenv').config({ path: '../.env' });
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../bot/data/users.json');
const WHITELIST_FILE = path.join(__dirname, '../bot/data/whitelist.json');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function loadJSON(filePath, defaultData) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error loading ${filePath}:`, error);
    }
    return defaultData;
}

function saveJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function createAdminAccount() {
    console.log('\n🔐 Create Admin Account\n');

    rl.question('Enter admin username: ', (username) => {
        rl.question('Enter admin password: ', (password) => {
            try {
                const users = loadJSON(USERS_FILE, { users: {} });
                const whitelist = loadJSON(WHITELIST_FILE, { whitelisted_users: [] });

                if (!whitelist.whitelisted_users.includes(username.toLowerCase())) {
                    console.log('\n❌ Error: User must be whitelisted first!');
                    console.log(`\nRun this command in Discord first:`);
                    console.log(`/bot-add-user username:${username}\n`);
                    rl.close();
                    process.exit(1);
                }

                users.users[username.toLowerCase()] = {
                    username: username,
                    password: password,
                    isAdmin: true,
                    createdAt: new Date().toISOString()
                };

                saveJSON(USERS_FILE, users);

                console.log('\n✅ Admin account created successfully!');
                console.log(`Username: ${username}`);
                console.log(`Password: ${password}`);
                console.log('\nYou can now login at http://localhost:3000\n');
            } catch (error) {
                console.error('\n❌ Error:', error.message);
            }
            rl.close();
            process.exit(0);
        });
    });
}

createAdminAccount();
