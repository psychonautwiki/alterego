'use strict';

const Logger = require('./logger');

const path = require('path');
const net = require('net');

const ircee = require('ircee');

class IrcEngineChild {
	constructor (irc, logger) {
		this._irc = irc;
		this._logger = logger;

		this._setupOrchestration();

		this._notifyReady();
	}

	_setupOrchestration () {
		process.on('exit', () => {
			this._logger.warn('Received exit event, quitting')
		});

		process.on('message', msg => {
			this._logger.trace(msg, 'Received event from sentinel');

			this._handleIPC(msg);
		});
	}

	_handleIPC (msg) {
		this._logger.trace(msg, 'Received event from sentinel');

		if (msg.init) {
			this._logger.debug('Initializing child..');

			this._initializeChild(msg);
		}

		if (msg.connection && this._irc) {
			this._logger.debug('Emitting connect event to IRC..');
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

		this._logger.debug(ipc, 'Connecting to IPC socket..');

		const ipcSocket = net.connect(ipc);

		ipcSocket.on('error', err =>
			this._logger.warn(err, 'Connecting to IPC failed')
		);

		ipcSocket.pipe(this._irc, {end: false}).pipe(ipcSocket);
	}

	_populateModules (modules) {
		return this._resolveModules(modules).map(require);
	}

	_resolveModules (modules) {
		return modules.map(module => {
			const modulePath = path.join(__dirname, '..', 'modules', module);

			this._logger.debug(modulePath, 'Loading module..');

			return modulePath
		});
	}

	_notifyReady () {
		process.send({
			ready: true
		});
	}
}

const logger = Logger('childOrchestrator');

new IrcEngineChild(new ircee(), logger);
