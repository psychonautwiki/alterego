'use strict';

/*

todo refactor

*/

const _ = require('lodash');

module.exports = function(irc) {
	var admins = irc.config.admins || [];

	var isAdmin = exports.isAdmin = function isAdmin(address) {
		var f = admins.filter(function(a) {
			return address.match(a);
		});
		return f.length;
	};

	var cmdchar = irc.config.chmdchar || '>';

	irc.on('privmsg', function(msg) {
		var sendto = msg.target[0] == '#' ? msg.target : msg.user.nick;

		if (msg.text.length && isAdmin(msg.source)) {
			var responder = {};

			responder.respond = irc.send.bind(irc, 'privmsg', sendto);

			if ( msg.target !== irc.config.info.nick ) return void 0;

			var _cmd = msg.text.split(' '),
			     cmd = _cmd[0];

			if (cmds[cmd]) {
				return cmds[cmd].apply(responder, [ msg, _cmd[1] ]);
			} else {
				return irc.send('notice', sendto, 'Unknown command.');
			}
		} else {
			return irc.send('notice', sendto, 'Unauthorized.');
		}
	});

	irc.on('403', function (msg) {
		if (!irc.config.bcnicks) return void 0;

		irc.config.bcnicks.forEach(function (nick) {
			irc.send('notice', nick, msg.text)
		});
	})

	const saveConfig = () => {
		delete irc.config['$0'];
		delete irc.config['_'];

		irc.supervisor({
			save: _.chain(irc.config).omit('$0').omit('_').value()
		});
	};

	var cmds = {};

	cmds.reload = function(msg) {
		irc.send('notice', msg.user.nick, 'Reloading..');

		irc.supervisor({
			reload: true
		});
	};

	cmds.admin = function(msg) {
		irc.send('notice', msg.user.nick, 'Yes you are');
	}

	cmds.join = function(msg, chan) {
		if (!~irc.config.channels.indexOf(chan)) {
			irc.config.channels.push(chan);
			saveConfig();
		}

		irc.send('join', chan);
	};

	cmds.part = function(msg, chan) {
		chan = chan || msg.target;

		if (~irc.config.channels.indexOf(chan)) {
			irc.config.channels.splice(irc.config.channels.indexOf(chan), 1);
			saveConfig();
		}

		irc.send('part', chan);
	};

	cmds.get = function(msg, jpath) {
		const value = _.get(irc.config, jpath);

		this.respond(JSON.stringify(value));
	};

	cmds.set = function(msg, jpath, val) {
		try {
			_.set(irc.config, jpath, JSON.parse(val))

			saveConfig();
			this.respond(last + ' = ' + JSON.stringify(c[last]));
		} catch(err) {
			irc.send('notice', msg.user.nick, `Nope. ${err.message}`);
		}
	}

	return cmds;
};
