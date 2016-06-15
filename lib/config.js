'use strict';

const Logger = require('./logger');
const logger = Logger('config');

const path = require('path');
const fs = require('fs');

const _ = require('lodash');
const yaml = require('js-yaml');

const filepath = path.resolve(process.cwd(), 'config.yaml');

module.exports = {
    load (args) {
        try {
            const configFile = fs.readFileSync(filepath, {
                encoding: 'utf8'
            });

            const config = yaml.load(configFile, {
                filename: filepath
            });

            _.extend(config, args);

            return config;
        } catch (err) {
            logger.warn(err, 'Failed to load configuration file, quitting');
            process.exit(1);
        }
    },
    save (data) {
        try {
            const configData = yaml.dump(data);

            fs.writeFile(filepath, configData);
        } catch(err) {
            logger.warn(err, 'Failed to write configuration file')
        }
    }
}
