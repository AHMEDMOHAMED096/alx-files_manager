const Queue = require('bull');
const imageThumbnail = require('image-thumbnail');
const fs = require('fs');
const path = require('path');
const dbClient = require('./utils/db');
const fileQueue = require('./utils/queue');

fileQueue.process('generateThumbnails', async (job, done) => {
    const { fileId, userId } = job.data;

    if (!fileId) {
        return done(new Error('Missing fileId'));
    }

    if (!userId) {
        return done(new Error('Missing userId'));
    }

    const file = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId), userId: new dbClient.ObjectId(userId) });

    if (!file) {
        return done(new Error('File not found'));
    }

    const sizes = [500, 250, 100];
    const options = { responseType: 'buffer' };

    try {
        for (const size of sizes) {
            const thumbnail = await imageThumbnail(file.localPath, { ...options, width: size });
            const thumbnailPath = `${file.localPath}_${size}`;
            fs.writeFileSync(thumbnailPath, thumbnail);
        }
        done();
    } catch (error) {
        done(error);
    }
});
