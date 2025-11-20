const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    success: {
        type: Boolean,
        required: true
    },
    ip: {
        type: String,
        default: 'unknown'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
