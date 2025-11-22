
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
    // Sender information
    senderUsername: {
        type: String,
        required: true
    },
    senderType: {
        type: String,
        enum: ['admin', 'client'],
        required: true
    },
    
    // Receiver information (for direct messages)
    receiverUsername: {
        type: String,
        default: null
    },
    
    // Message content
    message: {
        type: String,
        required: true,
        maxlength: 2000
    },
    
    // Status
    isRead: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date,
        default: null
    },
    
    // Metadata
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for efficient querying
chatMessageSchema.index({ senderUsername: 1, receiverUsername: 1, timestamp: -1 });
chatMessageSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
