const mongoose = require('mongoose');

const uidSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true,
        unique: true
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
    reminderSent: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Method to update status based on expiry
uidSchema.methods.updateStatus = function () {
    if (new Date() > this.expiresAt) {
        this.status = 'expired';
    }
    return this.status;
};

module.exports = mongoose.model('UID', uidSchema);
