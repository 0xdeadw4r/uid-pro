
const mongoose = require('mongoose');

const clientActivitySchema = new mongoose.Schema({
    clientUsername: {
        type: String,
        required: true,
        index: true
    },
    activityType: {
        type: String,
        enum: ['login', 'logout', 'download', 'hwid_reset', 'failed_login', 'password_change'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    ipAddress: {
        type: String,
        default: 'unknown'
    },
    userAgent: {
        type: String,
        default: ''
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    success: {
        type: Boolean,
        default: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Auto-cleanup old activities after 90 days
clientActivitySchema.statics.cleanup = async function() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await this.deleteMany({ timestamp: { $lt: ninetyDaysAgo } });
};

module.exports = mongoose.model('ClientActivity', clientActivitySchema);
