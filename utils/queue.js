const Queue = require('bull');

const fileQueue = new Queue('fileQueue');

module.exports = fileQueue;
