'use strict';

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
        } catch (e) {
            console.error(e);
            console.error("Config file invalid or not found.");
            process.exit(1);
        }
    },
    save (data) {
        try {
            const configData = yaml.dump(JSON.parse(data));

            fs.writeFile(filepath, configData);
        } catch(err) {
            console.log('Could not write configuration. ', err);
        }
    }
}