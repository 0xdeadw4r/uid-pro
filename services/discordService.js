const axios = require('axios');

// Send Discord notification
async function sendDiscordNotification(title, description, color = 3447003, fields = []) {
    try {
        if (!process.env.DISCORD_WEBHOOK_URL) {
            console.log('⚠️ Discord webhook not configured');
            return { success: false };
        }

        const embed = {
            embeds: [{
                title: title,
                description: description,
                color: color,
                fields: fields,
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'UID Manager Alert System'
                }
            }]
        };

        await axios.post(process.env.DISCORD_WEBHOOK_URL, embed);
        console.log('✅ Discord notification sent');
        return { success: true };
    } catch (error) {
        console.error('❌ Discord webhook error:', error.message);
        return { success: false, error: error.message };
    }
}

// Login notification
async function notifyLogin(username, ip, isAdmin, success) {
    const color = success ? 3066993 : 15158332; // Green if success, Red if failed
    const emoji = success ? '✅' : '❌';

    const title = success ? `${emoji} User Login` : `${emoji} Failed Login Attempt`;
    const description = success
        ? `**${username}** logged in successfully`
        : `Failed login attempt for **${username}**`;

    const fields = [
        { name: '👤 Username', value: username, inline: true },
        { name: '🌐 IP Address', value: ip, inline: true },
        { name: '🔑 Role', value: isAdmin ? 'Administrator' : 'User', inline: true },
        { name: '🕐 Time', value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), inline: false }
    ];

    return await sendDiscordNotification(title, description, color, fields);
}

// UID Creation notification
async function notifyUIDCreated(username, uid, packageName, credits) {
    const title = '🆕 New UID Created';
    const description = `**${username}** created a new UID`;

    const fields = [
        { name: '👤 User', value: username, inline: true },
        { name: '🔢 UID', value: uid, inline: true },
        { name: '📦 Package', value: packageName, inline: true },
        { name: '💳 Credits Used', value: `${credits} credits`, inline: true }
    ];

    return await sendDiscordNotification(title, description, 5763719, fields);
}

// UID Deletion notification
async function notifyUIDDeleted(username, uid) {
    const title = '🗑️ UID Deleted';
    const description = `**${username}** deleted a UID`;

    const fields = [
        { name: '👤 User', value: username, inline: true },
        { name: '🔢 UID', value: uid, inline: true }
    ];

    return await sendDiscordNotification(title, description, 15105570, fields);
}

// Admin Actions notification
async function notifyAdminAction(admin, action, target) {
    const title = '⚙️ Admin Action';
    const description = `**${admin}** performed an admin action`;

    const fields = [
        { name: '👤 Admin', value: admin, inline: true },
        { name: '🎯 Action', value: action, inline: true },
        { name: '📌 Target', value: target, inline: true }
    ];

    return await sendDiscordNotification(title, description, 15844367, fields);
}

// Credit Addition notification
async function notifyCreditAdded(admin, username, amount, newBalance) {
    const title = '💰 Credits Added';
    const description = `**${admin}** added credits to **${username}**`;

    const fields = [
        { name: '👤 Admin', value: admin, inline: true },
        { name: '🎯 Recipient', value: username, inline: true },
        { name: '💳 Amount', value: `${amount} credits`, inline: true },
        { name: '📊 New Balance', value: `${newBalance} credits`, inline: true }
    ];

    return await sendDiscordNotification(title, description, 3447003, fields);
}

module.exports = {
    sendDiscordNotification,
    notifyLogin,
    notifyUIDCreated,
    notifyUIDDeleted,
    notifyAdminAction,
    notifyCreditAdded
};
