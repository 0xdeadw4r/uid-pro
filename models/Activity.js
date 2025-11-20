const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Keep only last 100 activities
activitySchema.statics.cleanup = async function () {
    const count = await this.countDocuments();
    if (count > 100) {
        const toDelete = await this.find()
            .sort({ timestamp: 1 })
            .limit(count - 100)
            .select('_id');
        await this.deleteMany({ _id: { $in: toDelete.map(d => d._id) } });
    }
};

module.exports = mongoose.model('Activity', activitySchema);
