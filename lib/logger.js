'use strict';

const bunyan = require('bunyan');

module.exports = name =>
    bunyan.createLogger({
        name
    });
