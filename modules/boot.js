'use strict';

/*

todo refactor

*/

const _ = require('lodash');
const Promise = require('bluebird');

module.exports = Promise.coroutine(function* (irc) {
	const saveConfig = () => {
		delete irc.config['$0'];
		delete irc.config['_'];

		irc.supervisor({
			save: _.chain(irc.config).omit('$0').omit('_').value()
		});
	};

	irc.on('connect', function() {
		var core = irc.use(require('ircee/core'));

		core.login(irc.config.info);

		irc.config.channels.forEach(function(e) {
			irc.send('names', e);
		});
	});

	irc.on('001', function(e) {
		const channels = irc.config.channels || [];

		channels.forEach(channel =>
			irc.send('join', channel)
		);
	});

	irc.on('part', function(e) {
		if (e.user.nick === irc.config.info.nick) return void 0;

		// reload nicks
		irc.config.channels.forEach(function(e) {
			irc.send('names', e);
		});
	})

	irc.on('join', function(e) {
		if (e.user.nick === irc.config.info.nick) return void 0;

		// reload nicks
		irc.config.channels.forEach(function(e) {
			irc.send('names', e);
		});
	})

	irc.on('403', function(e) {
		irc.config.channels = irc.config.channels.filter(function(channel) {
			return channel && channel !== e.params[1] && channel[0] === '#'
		});

		saveConfig();
	})

	irc.on('464', function() {
		console.trace('NOT IMPLEMENTED: SERVER REQUIRES AUTHENTICATION!');
	})

	irc.on('477', function(e) {
		irc.config.channels = irc.config.channels.filter(function(channel) {
			return channel && channel !== e.params[1] && channel[0] === '#'
		});

		saveConfig();
	})
});
