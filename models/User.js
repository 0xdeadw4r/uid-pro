const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Basic User Info
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    email: {
        type: String,
        sparse: true,
        lowercase: true,
        trim: true
    },

    // User Role & Status
    isAdmin: {
        type: Boolean,
        default: false
    },

    // Admin Level System
    isSuperAdmin: {
        type: Boolean,
        default: false
    },
    isOwner: {
        type: Boolean,
        default: false
    },
    isLimitedAdmin: {
        type: Boolean,
        default: false
    },
    adminLevel: {
        type: String,
        enum: ['super', 'owner', 'limited', 'none'],
        default: 'none'
    },

    // Account Type System (UID_MANAGER or AIMKILL)
    accountType: {
        type: String,
        enum: ['UID_MANAGER', 'AIMKILL'],
        default: 'UID_MANAGER'
    },

    credits: {
        type: Number,
        default: 0
    },
    whitelisted: {
        type: Boolean,
        default: true
    },
    isPaused: {
        type: Boolean,
        default: false
    },
    pausedAt: {
        type: Date,
        default: null
    },

    // Discord OAuth Fields
    discordId: {
        type: String,
        sparse: true,
        default: null
    },
    discordUsername: {
        type: String,
        default: null
    },
    discordVerified: {
        type: Boolean,
        default: false
    },
    discordAvatar: {
        type: String,
        default: null
    },
    discordAccessToken: {
        type: String,
        default: null
    },
    discordRefreshToken: {
        type: String,
        default: null
    },
    discordTokenExpiresAt: {
        type: Date,
        default: null
    },
    discordEmail: {
        type: String,
        default: null
    },

    // Discord Guilds
    discordGuilds: [{
        guildId: String,
        guildName: String,
        joinedAt: Date
    }],

    // Guest Pass System
    isGuest: {
        type: Boolean,
        default: false
    },
    guestPassUsed: {
        type: Boolean,
        default: false
    },
    guestPassType: {
        type: String,
        enum: ['1day', '3days', null],
        default: null
    },
    guestPassExpiresAt: {
        type: Date,
        default: null
    },
    guestCreatedAt: {
        type: Date,
        default: null
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },

    // Guest Free Pass Settings (Admin controls)
    allowGuestFreeUID: {
        type: Boolean,
        default: true
    },
    allowGuestFreeAimkill: {
        type: Boolean,
        default: false
    },
    guestPassMaxDuration: {
        type: String,
        enum: ['1day', '3days', '7days', '15days', '30days'],
        default: '1day'
    },
    requireSocialVerification: {
        type: Boolean,
        default: false
    },
    youtubeChannelUrl: {
        type: String,
        default: ''
    },
    instagramProfileUrl: {
        type: String,
        default: ''
    },
    guestVideoUrl: {
        type: String,
        default: ''
    },

    // Guest Social Media Verification
    youtubeSubscribed: {
        type: Boolean,
        default: false
    },
    instagramFollowed: {
        type: Boolean,
        default: false
    },
    socialVerificationCode: {
        type: String,
        default: null
    },
    socialVerifiedAt: {
        type: Date,
        default: null
    },

    // Network Security
    networkFingerprint: {
        type: String,
        default: null
    },
    deviceFingerprint: {
        type: String,
        default: null
    },
    fingerprintLockedAt: {
        type: Date,
        default: null
    },

    // IP Whitelisting
    whitelistedIP: {
        type: String,
        default: null
    },
    ipSetAt: {
        type: Date,
        default: null
    },
    lastLoginIP: {
        type: String,
        default: null
    },
    lastLoginAt: {
        type: Date,
        default: null
    },

    // Two-Factor Authentication
    twoFactorEnabled: {
        type: Boolean,
        default: false
    },
    twoFactorSecret: {
        type: String,
        default: null
    },
    backupCodes: {
        type: [String],
        default: []
    },
    twoFactorEnabledAt: {
        type: Date,
        default: null
    },

    // Notification Preferences
    emailNotifications: {
        type: Boolean,
        default: true
    },
    discordNotifications: {
        type: Boolean,
        default: false
    },

    // Account Metadata
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    lastPasswordChange: {
        type: Date,
        default: null
    },

    // Security Flags
    accountLocked: {
        type: Boolean,
        default: false
    },
    lockReason: {
        type: String,
        default: null
    },
    lockedAt: {
        type: Date,
        default: null
    },
    failedLoginAttempts: {
        type: Number,
        default: 0
    },
    lastFailedLogin: {
        type: Date,
        default: null
    }
});

// Update timestamp on save
userSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    this.lastUpdated = Date.now(); // Ensure lastUpdated is also updated on save

    if (this.isOwner === undefined) {
        this.isOwner = false;
    }
    if (this.isSuperAdmin === undefined) {
        this.isSuperAdmin = false;
    }
    if (this.isLimitedAdmin === undefined) {
        this.isLimitedAdmin = false;
    }
    if (this.accountType === undefined) {
        this.accountType = 'UID_MANAGER';
    }

    if (this.isSuperAdmin) {
        this.adminLevel = 'super';
        this.isAdmin = true;
        this.isOwner = false;
        this.isLimitedAdmin = false;
    } else if (this.isOwner) {
        this.adminLevel = 'owner';
        this.isAdmin = false;
        this.isSuperAdmin = false;
        this.isLimitedAdmin = false;
    } else if (this.isLimitedAdmin) {
        this.adminLevel = 'limited';
        this.isAdmin = false;
        this.isSuperAdmin = false;
        this.isOwner = false;
    } else if (this.isAdmin) {
        this.adminLevel = 'super';
        this.isSuperAdmin = true;
        this.isOwner = false;
        this.isLimitedAdmin = false;
    } else {
        this.adminLevel = 'none';
    }

    next();
});

// Virtual for guest status display
userSchema.virtual('guestStatus').get(function () {
    if (!this.isGuest) return 'Regular User';
    if (this.guestPassUsed) return 'Guest (Pass Used)';
    return 'Guest (Free Pass Available)';
});

// Virtual for admin role display
userSchema.virtual('adminRole').get(function () {
    if (this.isSuperAdmin) return 'Super Admin';
    if (this.isOwner) return 'Owner';
    if (this.isLimitedAdmin) return 'Limited Admin';
    if (this.isAdmin) return 'Admin';
    if (this.isGuest) return 'Guest';
    return 'User';
});

// Virtual for account type display
userSchema.virtual('accountTypeDisplay').get(function () {
    if (this.accountType === 'AIMKILL') return 'Aimkill Manager';
    return 'UID Manager';
});

// Method to check if guest pass is expired
userSchema.methods.isGuestPassExpired = function () {
    if (!this.isGuest || !this.guestPassExpiresAt) return false;
    return new Date() > this.guestPassExpiresAt;
};

// Method to check if user can create UID
userSchema.methods.canCreateUID = function () {
    if (this.isSuperAdmin || this.isOwner || this.isLimitedAdmin || this.isAdmin) return true;
    if (this.isPaused) return false;
    if (this.accountLocked) return false;
    if (this.isGuest && !this.discordVerified) return false;
    if (this.isGuest && this.guestPassUsed) return false;
    if (!this.isGuest && this.credits <= 0) return false;
    return true;
};

// Method to check if user can create Aimkill keys
userSchema.methods.canCreateAimkillKeys = function () {
    if (this.accountType !== 'AIMKILL') return false;
    if (this.isPaused) return false;
    if (this.accountLocked) return false;
    if (this.credits <= 0) return false;
    return true;
};

// Check if user can access admin panel
userSchema.methods.canAccessAdmin = function () {
    return this.isSuperAdmin || this.isOwner || this.isLimitedAdmin || this.isAdmin;
};

// Check if user can access super admin features
userSchema.methods.canAccessSuperAdmin = function () {
    return this.isSuperAdmin || this.username === 'admin';
};

// Check if user can manage other admins
userSchema.methods.canManageAdmins = function () {
    return this.isSuperAdmin || this.username === 'admin';
};

// Check if user can see restoration features
userSchema.methods.canSeeRestoreFeatures = function () {
    return this.isSuperAdmin || this.username === 'admin';
};

// Check if user can change account types
userSchema.methods.canChangeAccountType = function (targetType) {
    if (this.accountType === targetType) return false;
    if (this.isSuperAdmin || this.isOwner) return true;
    return false;
};

// Method to reset network fingerprint
userSchema.methods.resetNetworkFingerprint = function () {
    this.networkFingerprint = null;
    this.fingerprintLockedAt = null;
    this.deviceFingerprint = null;
};

// Method to reset IP whitelist
userSchema.methods.resetIPWhitelist = function () {
    this.whitelistedIP = null;
    this.ipSetAt = null;
};

// Method to upgrade guest to regular user
userSchema.methods.upgradeToRegular = function (credits = 10) {
    this.isGuest = false;
    this.credits = credits;
    this.guestPassUsed = false;
    this.guestPassType = null;
    this.guestPassExpiresAt = null;
    this.accountType = 'UID_MANAGER';
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to change account type to Aimkill
userSchema.methods.changeToAimkill = function () {
    this.accountType = 'AIMKILL';
    if (!this.isAdmin && !this.isOwner && !this.isSuperAdmin) {
        this.credits = 10;
    }
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to change account type to UID Manager
userSchema.methods.changeToUIDManager = function () {
    this.accountType = 'UID_MANAGER';
    if (!this.isAdmin && !this.isOwner && !this.isSuperAdmin) {
        this.credits = 10;
    }
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to promote user to limited admin
userSchema.methods.promoteToLimitedAdmin = function () {
    this.isLimitedAdmin = true;
    this.isAdmin = false;
    this.isSuperAdmin = false;
    this.isOwner = false;
    this.adminLevel = 'limited';
    this.credits = 1000;
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to promote user to owner
userSchema.methods.promoteToOwner = function () {
    this.isOwner = true;
    this.isAdmin = false;
    this.isSuperAdmin = false;
    this.isLimitedAdmin = false;
    this.adminLevel = 'owner';
    this.credits = 5000;
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to promote user to super admin
userSchema.methods.promoteToSuperAdmin = function () {
    this.isSuperAdmin = true;
    this.isAdmin = true;
    this.isLimitedAdmin = false;
    this.isOwner = false;
    this.adminLevel = 'super';
    this.credits = 10000;
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Method to demote admin to regular user
userSchema.methods.demoteToUser = function () {
    this.isAdmin = false;
    this.isSuperAdmin = false;
    this.isLimitedAdmin = false;
    this.isOwner = false;
    this.adminLevel = 'none';
    this.accountType = 'UID_MANAGER';
    this.lastUpdated = Date.now(); // Update lastUpdated
};

// Static method to find active guests
userSchema.statics.findActiveGuests = function () {
    return this.find({
        isGuest: true,
        guestPassUsed: false
    });
};

// Static method to find expired guests
userSchema.statics.findExpiredGuests = function () {
    return this.find({
        isGuest: true,
        guestPassExpiresAt: { $lt: new Date() }
    });
};

// Static method to find all admins
userSchema.statics.findAllAdmins = function () {
    return this.find({
        $or: [
            { isSuperAdmin: true },
            { isOwner: true },
            { isLimitedAdmin: true },
            { isAdmin: true }
        ]
    });
};

// Static method to find owners only
userSchema.statics.findOwners = function () {
    return this.find({
        isOwner: true
    });
};

// Static method to find limited admins only
userSchema.statics.findLimitedAdmins = function () {
    return this.find({
        isLimitedAdmin: true
    });
};

// Static method to find super admins only
userSchema.statics.findSuperAdmins = function () {
    return this.find({
        isSuperAdmin: true
    });
};

// Static method to find Aimkill users
userSchema.statics.findAimkillUsers = function () {
    return this.find({
        accountType: 'AIMKILL'
    });
};

// Static method to find UID Manager users
userSchema.statics.findUIDManagerUsers = function () {
    return this.find({
        accountType: 'UID_MANAGER'
    });
};

// Index for performance
userSchema.index({ isGuest: 1, guestPassUsed: 1 });
userSchema.index({ adminLevel: 1 });
userSchema.index({ accountType: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);