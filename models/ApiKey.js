const mongoose = require('mongoose');

// ApiKey model for API-generated user:pass pairs
// These are NOT actual users, but credentials generated via API for external use
const apiKeySchema = new mongoose.Schema({
    // Username for the API-generated account
    username: {
        type: String,
        required: true,
        unique: true
    },
    // Password for the API-generated account
    password: {
        type: String,
        required: true
    },
    // Duration in days
    duration: {
        type: Number,
        required: true
    },
    // Who created this API key
    createdBy: {
        type: String,
        required: true
    },
    // When this key expires
    expiresAt: {
        type: Date,
        required: true
    },
    // Status: active or expired
    status: {
        type: String,
        enum: ['active', 'expired'],
        default: 'active'
    },
    // Account type (AIMKILL, UID_MANAGER, etc.)
    accountType: {
        type: String,
        enum: ['AIMKILL', 'UID_MANAGER'],
        default: 'AIMKILL'
    },
    // When this API key was created
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Method to update status based on expiry
apiKeySchema.methods.updateStatus = function () {
    if (new Date() > this.expiresAt) {
        this.status = 'expired';
    }
    return this.status;
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
