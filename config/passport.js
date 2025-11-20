const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const User = require('../models/User');

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Only configure Discord strategy if credentials are available
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL || '/auth/discord/callback',
        scope: ['identify', 'email', 'guilds', 'guilds.join'] // IMPORTANT: guilds.join for member restoration
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            console.log(`🔐 Discord OAuth: ${profile.username} (${profile.id})`);

            // Calculate token expiry (Discord tokens expire in 7 days by default)
            const expiresAt = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));

            // Check if user exists by Discord ID
            let user = await User.findOne({ discordId: profile.id });

            if (user) {
                // Update existing user with new tokens
                user.discordUsername = profile.username;
                user.discordVerified = true;
                user.discordAvatar = profile.avatar;
                user.discordEmail = profile.email;
                user.discordAccessToken = accessToken; // Save for guilds.join
                user.discordRefreshToken = refreshToken; // Save for token refresh
                user.discordTokenExpiresAt = expiresAt;
                user.lastLoginAt = new Date();
                await user.save();

                console.log(`✅ Existing user updated with new tokens: ${user.username}`);
                return done(null, user);
            }

            // Check if username already exists (case insensitive)
            const existingUsername = await User.findOne({
                username: profile.username.toLowerCase()
            });

            if (existingUsername) {
                // Link Discord to existing account
                existingUsername.discordId = profile.id;
                existingUsername.discordUsername = profile.username;
                existingUsername.discordVerified = true;
                existingUsername.discordAvatar = profile.avatar;
                existingUsername.discordEmail = profile.email;
                existingUsername.discordAccessToken = accessToken;
                existingUsername.discordRefreshToken = refreshToken;
                existingUsername.discordTokenExpiresAt = expiresAt;
                existingUsername.lastLoginAt = new Date();
                await existingUsername.save();

                console.log(`🔗 Discord linked to existing account: ${existingUsername.username}`);
                return done(null, existingUsername);
            }

            // Create new guest user with saved tokens
            user = await User.create({
                username: profile.username.toLowerCase(),
                password: Math.random().toString(36).slice(-12), // Random password
                email: profile.email,
                discordId: profile.id,
                discordUsername: profile.username,
                discordVerified: true,
                discordAvatar: profile.avatar,
                discordEmail: profile.email,
                discordAccessToken: accessToken, // Save for member restoration
                discordRefreshToken: refreshToken, // Save for token refresh
                discordTokenExpiresAt: expiresAt,
                isGuest: true,
                credits: 0,
                guestPassUsed: false,
                guestCreatedAt: new Date(),
                whitelisted: true,
                lastLoginAt: new Date()
            });

            console.log(`🆕 New guest user created with saved tokens: ${user.username}`);
            console.log(`📅 Token expires at: ${expiresAt.toISOString()}`);

            return done(null, user);

        } catch (err) {
            console.error('❌ Discord OAuth error:', err);
            return done(err, null);
        }
    }
    ));
} else {
    console.warn('⚠️ Discord OAuth credentials not found. Discord authentication will be disabled.');
}

module.exports = passport;
