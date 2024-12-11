const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const redisClient = require('../utils/redis');
const dbClient = require('../utils/db');

class FilesController {
    static async postUpload(req, res) {
        const token = req.headers['x-token'];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = await redisClient.get(`auth_${token}`);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { name, type, parentId = 0, isPublic = false, data } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Missing name' });
        }

        if (!['folder', 'file', 'image'].includes(type)) {
            return res.status(400).json({ error: 'Missing type' });
        }

        if (type !== 'folder' && !data) {
            return res.status(400).json({ error: 'Missing data' });
        }

        if (parentId !== 0) {
            const parentFile = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(parentId) });
            if (!parentFile) {
                return res.status(400).json({ error: 'Parent not found' });
            }
            if (parentFile.type !== 'folder') {
                return res.status(400).json({ error: 'Parent is not a folder' });
            }
        }

        const fileDocument = {
            userId: new dbClient.ObjectId(userId),
            name,
            type,
            isPublic,
            parentId: parentId === 0 ? 0 : new dbClient.ObjectId(parentId),
        };

        if (type === 'folder') {
            const result = await dbClient.db.collection('files').insertOne(fileDocument);
            return res.status(201).json({
                id: result.insertedId,
                userId,
                name,
                type,
                isPublic,
                parentId,
            });
        }

        const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const localPath = path.join(folderPath, uuidv4());
        fs.writeFileSync(localPath, Buffer.from(data, 'base64'));

        fileDocument.localPath = localPath;

        const result = await dbClient.db.collection('files').insertOne(fileDocument);
        return res.status(201).json({
            id: result.insertedId,
            userId,
            name,
            type,
            isPublic,
            parentId,
            localPath,
        });
    }

    static async getShow(req, res) {
        const token = req.headers['x-token'];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = await redisClient.get(`auth_${token}`);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const fileId = req.params.id;
        const file = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId), userId: new dbClient.ObjectId(userId) });

        if (!file) {
            return res.status(404).json({ error: 'Not found' });
        }

        return res.status(200).json(file);
    }

    static async getIndex(req, res) {
        const token = req.headers['x-token'];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = await redisClient.get(`auth_${token}`);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const parentId = req.query.parentId || 0;
        const page = parseInt(req.query.page, 10) || 0;
        const pageSize = 20;

        const files = await dbClient.db.collection('files')
            .aggregate([
                { $match: { parentId: parentId === 0 ? 0 : new dbClient.ObjectId(parentId), userId: new dbClient.ObjectId(userId) } },
                { $skip: page * pageSize },
                { $limit: pageSize },
            ])
            .toArray();

        return res.status(200).json(files);
    }

    static async putPublish(req, res) {
        const token = req.headers['x-token'];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = await redisClient.get(`auth_${token}`);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const fileId = req.params.id;
        const file = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId), userId: new dbClient.ObjectId(userId) });

        if (!file) {
            return res.status(404).json({ error: 'Not found' });
        }

        await dbClient.db.collection('files').updateOne({ _id: new dbClient.ObjectId(fileId) }, { $set: { isPublic: true } });
        const updatedFile = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId) });

        return res.status(200).json(updatedFile);
    }

    static async putUnpublish(req, res) {
        const token = req.headers['x-token'];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = await redisClient.get(`auth_${token}`);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const fileId = req.params.id;
        const file = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId), userId: new dbClient.ObjectId(userId) });

        if (!file) {
            return res.status(404).json({ error: 'Not found' });
        }

        await dbClient.db.collection('files').updateOne({ _id: new dbClient.ObjectId(fileId) }, { $set: { isPublic: false } });
        const updatedFile = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId) });

        return res.status(200).json(updatedFile);
    }

    static async getFile(req, res) {
        const fileId = req.params.id;
        const file = await dbClient.db.collection('files').findOne({ _id: new dbClient.ObjectId(fileId) });

        if (!file) {
            return res.status(404).json({ error: 'Not found' });
        }

        if (!file.isPublic) {
            const token = req.headers['x-token'];
            if (!token) {
                return res.status(404).json({ error: 'Not found' });
            }

            const userId = await redisClient.get(`auth_${token}`);
            if (!userId || userId !== file.userId.toString()) {
                return res.status(404).json({ error: 'Not found' });
            }
        }

        if (file.type === 'folder') {
            return res.status(400).json({ error: "A folder doesn't have content" });
        }

        if (!fs.existsSync(file.localPath)) {
            return res.status(404).json({ error: 'Not found' });
        }

        const mimeType = mime.lookup(file.name);
        res.setHeader('Content-Type', mimeType);
        fs.createReadStream(file.localPath).pipe(res);
    }
}

module.exports = FilesController;
