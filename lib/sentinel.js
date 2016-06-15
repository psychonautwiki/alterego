'use strict';

const net = require('net');
const tls = require('tls');

const args = require('optimist').argv;
const cp = require('child_process');
const ircee = require('ircee');
const through = require('through');

const Logger = require('./logger')
const config = require('./config');

const loadConfig = () => config.load(args);

/* Sentinel configuration */

const ipcPath = `/tmp/sentry-${process.pid}.sock`;

const tcpSocketTimeout = 90 * 1000;
const tcpReconnectDelay = 10 * 1000;

const orchestratorPath = __dirname + '/orchestrator.js';
const orchestratorReloadDelay = 2000;
const orchestratorReadyPingInterval = 500;

class TcpConnection {
    constructor(irc, logger, {input, output}, config) {
        this._irc = irc;
        this._config = config;

        this._logger = logger.child({
            type: 'tcpConnection'
        });

        this._pings = 0;

        this._streams = {input, output};

        this._connect();
        this._hookIrc();
    }

    _hookIrc () {
        this._irc.on('pong', () => {
            this._logger.trace('Received pong from IRC');

            --this.pings;
        });
    }

    _connect () {
        this._pings = 0;

        const params = {
            port: this._config.port,
            host: this._config.server
        };

        if (this._config.vhost) {
            params.localAddress = this._config.vhost;
        }

        if (this._config.ssl) {
            params.rejectUnauthorized = !this._config.allowInsecure;

            this._socket = tls.connect(params);
        } else {
            this._socket = net.connect(params);
        }

        this._socket.on('data', msg =>
            this._logger.trace(msg, 'Incoming TCP message')
        );

        this._socket.pipe(this._streams.input, {
            end: false
        });

        this._streams.output.on('data', msg =>
            this._logger.trace(msg, 'Outgoing TCP message')
        );

        this._streams.output.pipe(this._socket, {
            end: false
        });

        this._socket.pipe(this._irc, {
            end: false
        }).pipe(this._socket);

        this._socket.on('timeout', () => {
            this._logger.warn('Received timeout');

            if (this._pings++ > 1) {
                this._logger.warn('Connection timedout more than twice, destroying connection');

                return this._socket.destroy();
            }

            this._logger.debug('Pinging IRC server..');
            this._irc.send('PING', Date.now());
        });

        this._socket.setTimeout(tcpSocketTimeout);

        this._socket.on('error', err =>
            this._logger.warn(err, 'Socket errored')
        );

        this._socket.on('close', err => {
            this._logger.warn('Connection was closed, reconnecting..');

            const delay = tcpReconnectDelay;

            setTimeout(() =>
                process.nextTick(() =>
                    this._connect()
                )
            , delay);
        });
    }
}

class ChildOrchestrator {
    constructor (irc, logger, config) {
        this._irc = irc;
        this._config = config;

        this._logger = logger.child({
            type: 'childOrchestrator'
        });

        this._initIPC();

        this._hookIrc();
        this._hookProcess();
    }

    _hookIrc () {
        this._irc.on('pong', () => {
            this._logger.trace('Received pong from IRC');

            --this.pings
        });

        this._irc.on('connect', () => {
            this._logger.debug('Connected to IRC, notifying child orchestrator');

            this._readyChild(0);
        });
    }

    _hookProcess () {
        process.on('SIGHUP', () => {
            this._logger.info('Received SIGHUP, respawning child orchestrator');

            this._reloadChild();
        });
    }

    _initIPC () {
        this._ipcadr = {
            path: ipcPath
        };

        this._socket = null;

        this._ipc = net.createServer(socket => {
            this._logger.debug('Connection from child orchestrator');

            this._irc.streams.input.on('data', msg =>
                this._logger.trace(msg, 'Forwarding IRC message to IPC')
            );

            this._irc.streams.input.pipe(socket, {
                end: false
            });

            this._irc.streams.input.on('data', msg =>
                this._logger.trace(msg, 'Forwarding IPC message to IRC')
            );

            socket.pipe(this._irc.streams.output, {
                end: false
            });

            socket.on('error', err =>
                this._logger.debug(err, 'Received error from child orchestrator')
            );
        });

        this._ipcTarget = this._ipcadr.path || this._ipcadr.port;

        this._ipc.listen(this._ipcTarget, () => {
            this._logger.info('IPC is online.');

            this._ipcOnline();
        });
    }

    _ipcOnline () {
        this._ipcadr.port = this._ipc.address().port;

        this._spawnChild();
    }

    _spawnChild () {
        this._logger.info(`Spawning child '${orchestratorPath}'`);

        this._child = cp.spawn('node', [
            orchestratorPath
        ], {
            env: process.env,
            stdio: [null, null, null, 'ipc']
        });

        this._child.on('exit', statusCode => {
            this._logger.warn(`Child exit with status code '${statusCode}'`);

            if (!statusCode) return false;

            setTimeout(() =>
                process.nextTick(() =>
                    this._reloadChild()
                )
            , orchestratorReloadDelay);
        });

        try {
            this._child.stdout.pipe(process.stdout);
            this._child.stderr.pipe(process.stderr);
        } catch (e) {}

        this._child.on('message', (msg, handler) => {
            if (msg.reload) {
                this._logger.info('Received reload event from child orchestrator');

                return this._reloadChild();
            }

            if (msg.save) {
                this._logger.info(msg.save, 'Received save event from child orchestrator');

                return Config.save(msg.save);
            }
        });

        this._child.send({
            init: true,
            config: this._config,
            ipc: this._ipcadr
        });
    }

    _reloadChild () {
        this._logger.debug('Reloading configuration..');

        try {
            this._config = loadConfig();
        } catch (err) {
            this._logger.warn(err, 'Failed to reload configuration');
        }

        this._irc.config = config;

        this._logger.debug('Killing child orchestrator..');

        try {
            this._child.kill('SIGKILL');
        } catch (err) {
            this._logger.warn(err, 'Failed to kill child orchestrator');
        }

        this._spawnChild();
    }

    _readyChild (iteration) {
        if (this._child) {
            this._logger.debug('Pinging child orchestrator..');

            try {
                return this._child.send({
                    connection: true
                });
            } catch (err) {
                this._logger.warn(err, 'Failed to ping child orchestrator');
            }
        }

        if (iteration < orchestratorReadyCheckMax) {
            /* retry notifying child */
            return setTimeout(() =>
                this._readyChild(iteration++)
            , orchestratorReadyPingInterval);
        }

        this._logger.warn(`Failed to receive pong from child orchestrator after ${orchestratorReadyCheckMax} tries, respawning child`);

        return this._reloadChild();
    }
}

class IrcEngine {
    constructor (logger, config) {
        this._logger = logger;
        this._config = config;

        this._streams = {
            input: through(),
            output: through()
        };

        this._initIrc();

        this.tcpConnection = new TcpConnection(
            this._irc,
            this._logger,
            {
                input: this._streams.input,
                output: this._streams.output
            },
            config
        );

        this._childOrchestrator = new ChildOrchestrator(
            this._irc, this._logger, config
        );
    }

    _initIrc () {
        this._irc = new ircee();

        this._irc.config = this._config;

        this._irc.use(require('ircee/core'));

        this._irc.streams = {
            input: this._streams.input,
            output: this._streams.output
        };
    }
}

const enrichedConfig = loadConfig();
const logger = Logger('sentinel');

const ircEngine = new IrcEngine(logger, enrichedConfig);
