const crypto = require('crypto');

// Normalize IP address to consistent format
function normalizeIP(ip) {
    if (!ip) return '127.0.0.1';

    // Handle localhost variations
    if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
        return '127.0.0.1';
    }

    // Remove IPv6 prefix for IPv4-mapped addresses
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }

    // If multiple IPs (x-forwarded-for), take the first one
    if (ip.includes(',')) {
        return ip.split(',')[0].trim();
    }

    return ip;
}

// Generate network fingerprint - STABLE VERSION (User Agent only)
function generateNetworkFingerprint(req) {
    // Only use User Agent - most stable identifier across sessions
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Create hash from User Agent only (full version for security)
    const fingerprint = crypto.createHash('sha256').update(userAgent).digest('hex');

    // Debug logging
    console.log(`🔍 Fingerprint Debug:`);
    console.log(`   User Agent: ${userAgent.substring(0, 50)}...`);
    console.log(`   Fingerprint: ${fingerprint.substring(0, 16)}...`);

    return fingerprint;
}

// Check if network fingerprint matches
async function checkNetworkFingerprint(req, res, next) {
    // CRITICAL: Skip for ALL API routes (fixes login lockout)
    if (req.path.includes('/api/')) {
        return next();
    }

    // Skip for public pages
    if (req.path.includes('/login') ||
        req.path.includes('/register') ||
        req.path.includes('/auth/discord') ||
        req.path === '/') {
        return next();
    }

    // Skip for non-logged-in users
    if (!req.session.user) {
        return next();
    }

    // Skip for admins
    if (req.session.user.isAdmin) {
        return next();
    }

    try {
        const User = require('../models/User');
        const user = await User.findOne({ username: req.session.user.username });

        if (!user) return next();

        // Skip network lock for guest accounts
        if (user.isGuest) {
            console.log(`👤 Skipping network lock for guest: ${user.username}`);
            return next();
        }

        const currentFingerprint = generateNetworkFingerprint(req);

        // First access - set fingerprint
        if (!user.networkFingerprint) {
            user.networkFingerprint = currentFingerprint;
            user.fingerprintLockedAt = new Date();
            await user.save();
            console.log(`🔒 Network fingerprint locked for ${user.username}`);
            return next();
        }

        // Check if fingerprint matches
        if (user.networkFingerprint !== currentFingerprint) {
            console.log(`⚠️ Network fingerprint mismatch for ${user.username}`);
            console.log(`   Expected: ${user.networkFingerprint.substring(0, 16)}...`);
            console.log(`   Got: ${currentFingerprint.substring(0, 16)}...`);
            console.log(`   Note: Browser/device changed. User needs to contact admin.`);

            // Redirect to login instead of API error
            req.session.destroy();
            return res.redirect('/login?error=device_changed');
        }

        next();
    } catch (error) {
        console.error('Fingerprint check error:', error);
        next();
    }
}

module.exports = {
    generateNetworkFingerprint,
    checkNetworkFingerprint
};
