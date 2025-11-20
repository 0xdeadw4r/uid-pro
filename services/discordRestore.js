const axios = require('axios');
const User = require('../models/User');

// Add a single user to a Discord server using their saved OAuth token
async function addUserToGuild(userId, guildId, botToken) {
    try {
        const user = await User.findOne({ discordId: userId });

        if (!user) {
            throw new Error('User not found in database');
        }

        if (!user.discordAccessToken) {
            throw new Error('User has no saved Discord token - they need to re-authorize');
        }

        // Check if token is expired
        if (user.discordTokenExpiresAt && new Date() > user.discordTokenExpiresAt) {
            console.log(`⏰ Token expired for ${user.discordUsername}, attempting refresh...`);

            // Try to refresh the token
            const refreshed = await refreshDiscordToken(user);
            if (!refreshed) {
                throw new Error('Discord token expired and refresh failed - user needs to re-authorize');
            }
        }

        // Add user to guild using Discord API
        const response = await axios.put(
            `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
            {
                access_token: user.discordAccessToken
            },
            {
                headers: {
                    'Authorization': `Bot ${botToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`✅ Added ${user.discordUsername} (${userId}) to guild ${guildId}`);

        // Update user's guild list
        if (!user.discordGuilds) {
            user.discordGuilds = [];
        }

        // Check if guild already exists in user's list
        const existingGuild = user.discordGuilds.find(g => g.guildId === guildId);
        if (!existingGuild) {
            user.discordGuilds.push({
                guildId: guildId,
                guildName: 'Restored Server',
                joinedAt: new Date()
            });
            await user.save();
        }

        return {
            success: true,
            username: user.discordUsername,
            userId: userId
        };

    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        console.error(`❌ Failed to add user ${userId}:`, errorMsg);

        return {
            success: false,
            error: errorMsg,
            userId: userId
        };
    }
}

// Restore all members to a new server
async function restoreAllMembers(newGuildId, botToken) {
    try {
        console.log(`\n🔄 Starting member restoration to guild ${newGuildId}...`);

        // Get all users with saved Discord tokens that haven't expired
        const users = await User.find({
            discordAccessToken: { $exists: true, $ne: null },
            $or: [
                { discordTokenExpiresAt: { $gt: new Date() } }, // Valid tokens
                { discordRefreshToken: { $exists: true, $ne: null } } // Or has refresh token
            ]
        });

        console.log(`📊 Found ${users.length} users with Discord tokens`);

        const results = {
            total: users.length,
            success: 0,
            failed: 0,
            expired: 0,
            errors: [],
            successUsers: [],
            failedUsers: []
        };

        // Add each user to the new server
        for (let i = 0; i < users.length; i++) {
            const user = users[i];

            console.log(`\n[${i + 1}/${users.length}] Processing ${user.discordUsername}...`);

            const result = await addUserToGuild(user.discordId, newGuildId, botToken);

            if (result.success) {
                results.success++;
                results.successUsers.push(user.discordUsername);
                console.log(`  ✅ Success`);
            } else {
                results.failed++;
                results.failedUsers.push({
                    username: user.discordUsername,
                    error: result.error
                });
                results.errors.push({
                    username: user.discordUsername,
                    discordId: user.discordId,
                    error: result.error
                });
                console.log(`  ❌ Failed: ${result.error}`);
            }

            // Rate limit: Wait 1.2 seconds between requests to avoid Discord rate limits
            if (i < users.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
        }

        console.log(`\n✅ Restoration complete!`);
        console.log(`   Success: ${results.success}/${results.total}`);
        console.log(`   Failed: ${results.failed}/${results.total}`);

        return results;

    } catch (error) {
        console.error('❌ Restoration error:', error);
        throw error;
    }
}

// Refresh expired Discord token
async function refreshDiscordToken(user) {
    try {
        if (!user.discordRefreshToken) {
            console.log(`  ⚠️ No refresh token available for ${user.discordUsername}`);
            return false;
        }

        console.log(`  🔄 Refreshing token for ${user.discordUsername}...`);

        const response = await axios.post(
            'https://discord.com/api/v10/oauth2/token',
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: user.discordRefreshToken
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = response.data;

        // Update user with new tokens
        user.discordAccessToken = access_token;
        user.discordRefreshToken = refresh_token;
        user.discordTokenExpiresAt = new Date(Date.now() + expires_in * 1000);
        await user.save();

        console.log(`  ✅ Token refreshed successfully`);
        return true;

    } catch (error) {
        console.error(`  ❌ Token refresh failed:`, error.response?.data || error.message);
        return false;
    }
}

// Get restoration statistics
async function getRestorationStats() {
    try {
        const totalUsers = await User.countDocuments({ discordVerified: true });

        const usersWithTokens = await User.countDocuments({
            discordAccessToken: { $exists: true, $ne: null }
        });

        const usersWithValidTokens = await User.countDocuments({
            discordAccessToken: { $exists: true, $ne: null },
            discordTokenExpiresAt: { $gt: new Date() }
        });

        const usersWithRefreshTokens = await User.countDocuments({
            discordRefreshToken: { $exists: true, $ne: null }
        });

        return {
            totalDiscordUsers: totalUsers,
            usersWithTokens: usersWithTokens,
            usersWithValidTokens: usersWithValidTokens,
            usersWithRefreshTokens: usersWithRefreshTokens,
            restorable: usersWithValidTokens + usersWithRefreshTokens
        };

    } catch (error) {
        console.error('Error getting stats:', error);
        return null;
    }
}

// Check if a specific user can be restored
async function checkUserRestorability(username) {
    try {
        const user = await User.findOne({ username: username.toLowerCase() });

        if (!user) {
            return { canRestore: false, reason: 'User not found' };
        }

        if (!user.discordVerified) {
            return { canRestore: false, reason: 'Not verified with Discord' };
        }

        if (!user.discordAccessToken && !user.discordRefreshToken) {
            return { canRestore: false, reason: 'No Discord tokens saved' };
        }

        if (user.discordTokenExpiresAt && new Date() > user.discordTokenExpiresAt) {
            if (user.discordRefreshToken) {
                return { canRestore: true, reason: 'Token expired but can be refreshed' };
            }
            return { canRestore: false, reason: 'Token expired and no refresh token' };
        }

        return { canRestore: true, reason: 'Token valid' };

    } catch (error) {
        console.error('Check restorability error:', error);
        return { canRestore: false, reason: 'Error checking user' };
    }
}

module.exports = {
    addUserToGuild,
    restoreAllMembers,
    refreshDiscordToken,
    getRestorationStats,
    checkUserRestorability
};
