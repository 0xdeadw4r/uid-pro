const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const USERS_FILE = path.join(__dirname, '../../bot/data/users.json');
const WHITELIST_FILE = path.join(__dirname, '../../bot/data/whitelist.json');

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

// Create a user account with password
async function createUser(username, password, isAdmin = false) {
    const users = loadJSON(USERS_FILE, { users: {} });
    const whitelist = loadJSON(WHITELIST_FILE, { whitelisted_users: [] });

    // Check if user is whitelisted
    if (!whitelist.whitelisted_users.includes(username.toLowerCase())) {
        throw new Error('User must be whitelisted first');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    users.users[username.toLowerCase()] = {
        username: username,
        password: hashedPassword,
        isAdmin: isAdmin,
        createdAt: new Date().toISOString()
    };

    saveJSON(USERS_FILE, users);
    return true;
}

// Verify user login
async function verifyUser(username, password) {
    const users = loadJSON(USERS_FILE, { users: {} });
    const user = users.users[username.toLowerCase()];

    if (!user) {
        return { success: false, error: 'User not found. Please contact admin to set up your account.' };
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
        return { success: false, error: 'Invalid password' };
    }

    return {
        success: true,
        user: {
            username: user.username,
            isAdmin: user.isAdmin
        }
    };
}

// Change user password
async function changePassword(username, oldPassword, newPassword) {
    const users = loadJSON(USERS_FILE, { users: {} });
    const user = users.users[username.toLowerCase()];

    if (!user) {
        return { success: false, error: 'User not found' };
    }

    const passwordMatch = await bcrypt.compare(oldPassword, user.password);

    if (!passwordMatch) {
        return { success: false, error: 'Invalid current password' };
    }

    user.password = await bcrypt.hash(newPassword, 10);
    users.users[username.toLowerCase()] = user;
    saveJSON(USERS_FILE, users);

    return { success: true };
}

module.exports = {
    createUser,
    verifyUser,
    changePassword
};
