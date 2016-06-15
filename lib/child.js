'use strict';

const path = require('path');
const net = require('net');

const ircee = require('ircee');

class IrcEngineChild {
	constructor (irc) {
		this._irc = irc;

		this._setupOrchestration();

		this._notifyReady();
	}

	_setupOrchestration () {
		process.on('exit', function() {
			console.log('child: exitting.');
		});

		process.on('message', msg =>
			this._handleIPC(msg)
		);
	}

	_handleIPC (msg) {
		if (msg.init) {
			this._initializeChild(msg);
		}

		if (msg.connection && this._irc) {
			this._irc.emit('connect');
		}
	}

	_initializeChild ({config, ipc}) {
		this._irc.use(require('ircee/core'));

		this._irc.supervisor = msg =>
			process.send(msg);

		this._irc.config = config;

		const populatedModules = this._populateModules(this._irc.config.modules);

		populatedModules.forEach(module =>
			this._irc.use(module)
		);

		console.log("child: connecting to ipc channel", ipc);

		const ipcSocket = net.connect(ipc);

		ipcSocket.pipe(this._irc, {end: false}).pipe(ipcSocket);
	}

	_populateModules (modules) {
		return this._resolveModules(modules).map(require);
	}

	_resolveModules (modules) {
		return modules.map(module =>
			path.join(__dirname, '..', 'modules', module)
		);
	}

	_notifyReady () {
		process.send({
			ready: true
		});
	}
}

new IrcEngineChild(new ircee());