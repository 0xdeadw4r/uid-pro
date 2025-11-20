
const mongoose = require('mongoose');

const aimkillKeySchema = new mongoose.Schema({
    key: {
        type: String,
        default: null
    },
    type: {
        type: String,
        enum: ['license_key', 'user_account'],
        default: 'user_account'
    },
    username: {
        type: String,
        default: null
    },
    password: {
        type: String,
        default: null
    },
    duration: {
        type: Number,
        required: true
    },
    createdBy: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'expired'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Method to update status based on expiry
aimkillKeySchema.methods.updateStatus = function () {
    if (new Date() > this.expiresAt) {
        this.status = 'expired';
    }
    return this.status;
};

module.exports = mongoose.model('AimkillKey', aimkillKeySchema);
