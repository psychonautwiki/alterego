const args = require('optimist').argv;
const ircee = require('ircee');
const cp = require('child_process');
const net = require('net'), tls = require('tls');
const through = require('through');

const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const path = require('path');

const Config = require('./config.js');

const configFile = path.resolve(process.cwd(), args._[0] || 'config.yaml');

const loadConfig = () => Config.load(args);

Error.stackTraceLimit = Infinity;

class TcpConnection {
    constructor(irc, {input, output}, config) {
        this._irc = irc;
        this._config = config;

        this._pings = 0;

        this._streams = {input, output};

        this._connect();
        this._hookIrc();
    }

    _hookIrc () {
        this._irc.on('pong', () =>
            --this.pings
        );
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

        this._socket.pipe(this._streams.input, {
            end: false
        });

        this._streams.output.pipe(this._socket, {
            end: false
        });

        this._socket.pipe(this._irc, {
            end: false
        }).pipe(this._socket);

        this._socket.on('error', err =>
            console.log('this._socket error:', err)
        );

        this._socket.on('timeout', () => {
            if (++this._pings > 1) {
                return this._socket.destroy();
            }

            this._irc.send('PING', new Date().getTime());
        });

        this._socket.setTimeout(90 * 1000);
        this._socket.on('error', err =>
            console.log('Connection error', err)
        );

        this._socket.on('close', err => {
            console.log('Connection closed, trying to reconnect...');

            const delay = this._irc.config.reconnectDelay * 1000 || 15000;

            setTimeout(() =>
                process.nextTick(() =>
                    this._connect()
                )
            , delay);
        });
    }
}

class ChildController {
    constructor (irc, config) {
        this._irc = irc;
        this._config = config;

        this._initIPC();
        this._hookIrc();
    }

    _hookIrc () {
        this._irc.on('pong', () =>
            --this.pings
        );

        this._irc.on('connect', () =>
            this._readyChild(0)
        );
    }

    _initIPC () {
        this._ipcadr = {
            path: '/tmp/sentry-' + process.pid + '.sock'
        };

        this._socket = null;

        this._ipc = net.createServer(socket => {
            console.log('parent: child process connected');

            this._irc.streams.input.pipe(socket, {
                end: false
            });

            socket.pipe(this._irc.streams.output, {
                end: false
            });

            socket.on('error', () => {});
        });

        this._ipcTarget = this._ipcadr.path || this._ipcadr.port;

        this._ipc.listen(this._ipcTarget, () => this._ipcOnline());
    }

    _ipcOnline () {
        this._ipcadr.port = this._ipc.address().port;

        this._spawnChild();
    }

    _spawnChild () {
        this._child = cp.spawn('node', [
            __dirname + '/child.js'
        ], {
            env: process.env,
            stdio: [null, null, null, 'ipc']
        });

        this._child.on('exit', statusCode => {
            console.log('Child exit with status code', statusCode);

            if (!statusCode) return false;

            const reloadDelay = 3000;

            setTimeout(() =>
                process.nextTick(() =>
                    this._reloadChild()
                )
            , reloadDelay);
        });

        try {
            this._child.stdout.pipe(process.stdout);
            this._child.stderr.pipe(process.stderr);
        } catch (e) {}

        this._child.on('message', (msg, handler) => {
            if (msg.reload) {
                return this._reloadChild();
            }

            if (msg.save) {
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
        try {
            this._config = loadConfig();
        } catch (e) {}

        this._irc.config = config;

        try {
            this._child.kill('SIGKILL');
        } catch (e) {}

        this._spawnChild();
    }

    _readyChild (iteration) {
        if (this._child) {
            try {
                return this._child.send({
                    connection: true
                });
            } catch (e) {}
        }

        if (iteration < 10) {
            const retryDelay = 1000;

            return setTimeout(() =>
                this._childReady(iteration++)
            , retryDelay);
        }

        throw new Error('Failed to connect.');
    }
}

class IrcEngine {
    constructor (config) {
        this._config = config;

        this._streams = {
            input: through(),
            output: through()
        };

        this._initIrc();

        this.tcpConnection = new TcpConnection(
            this._irc,
            {
                input: this._streams.input,
                output: this._streams.output
            },
            config
        );

        this._childController = new ChildController(
            this._irc, config
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

const config = loadConfig();

const ircEngine = new IrcEngine(config);