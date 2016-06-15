'use strict';

const bunyan = require('bunyan');

module.exports = name =>
    bunyan.createLogger({
        name, level: process.env.LEVEL || 'info'
    });
