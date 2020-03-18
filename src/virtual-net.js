const EventEmitter = require('events');
const stream = require('stream');
const Duplex = stream.Duplex;

class Network extends EventEmitter {
  constructor() {
    super();
    this._servers = {};
    this._traceSessions = null;
  }

  createServer(options, connectionListener) {
    const server = new Server(this, options, connectionListener);
    return server;
  }

  connect(remote, connectionListener) {
    const client = new MemoryStream();
    setImmediate(() => {
      const server = this._servers[`${remote.host}:${remote.port}`];
      if (!server) {
        client.emit('error', 'Server does not exist');
      } else {
        const socket = server._connect(client);
        connectionListener();
      }
    });
    return client;
  }
}
class Server extends EventEmitter {
  constructor(net, options, connectionListener) {
    super();
    this._net = net;
    this._connectionListener =  typeof options == 'function' ? options : connectionListener;
    this._listens = [];
  }
  listen(port, host) {
    const hostPort = `${host}:${port}`;
    if (this._net._servers[hostPort]) throw new Error("Port already in use: " + hostPort);
    this._net._servers[hostPort] = this;
    this._listens.push(hostPort);
  }
  close() {
    this._listens.forEach((hostPort) => delete this._net._servers[hostPort]);
    this._listens = [];
  }

  _connect(clientStream) {
    const serverStream = new MemoryStream();
    if (this._net._traceSessions) {
      this._net._traceSessions.push({
        clientStream,
        serverStream,
        pause: () => {
          clientStream._pause();
          serverStream._pause();
        },
        unpause: () => {
          clientStream._unpause();
          serverStream._unpause();
        }
      });
    }
    serverStream.couple(clientStream);
    setImmediate(() => this._connectionListener(serverStream));
  }
}

class MemoryStream extends EventEmitter {
  constructor() {
    super();
    this._buffers = {};
    this._listeners = {};
    this._corked = false;
    this._bottle = null;
    this._paused = false;
    this._pauseBuffer = null;
  }
  couple(other) {
    ['data', 'end'].forEach((ev) => {
      other.on(`_${ev}`, (a,b,c,d) => this.emit(ev,a,b,c,d));
      this.on(`_${ev}`, (a,b,c,d) => other.emit(ev,a,b,c,d));
    })
  }

  read(size) {}

  on(ev, handler) {
    super.on(ev, handler);
    (this._listeners[ev] || (this._listeners[ev] = [])).push(handler);
    (this._buffers[ev]||[]).forEach((args) => {
      super.emit.apply(this, args)
    });
    delete this._buffers[ev];
  }

  emit(ev) {
    const args = [];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    if (!this._listeners[ev]) {
      (this._buffers[ev] || (this._buffers[ev] = [])).push(args);
    } else {
      super.emit.apply(this, arguments);
    }
  }

  write(chunk, encoding, callback) {
    if (typeof chunk == 'string') return this.write(new Buffer(chunk), null, callback);
    if (this._corked) {
      this._bottle.push(chunk);
    } else if (this._paused) {
      this._pauseBuffer.push(chunk);
    } else {
      this.emit('_data', new Buffer(chunk));
    }
  }

  end() {
    this.emit('_end');
  }

  setNoDelay() { /* noop */ }
  setKeepAlive() { /* noop */ }
  setTimeout() { /* noop */ }
  address() {
    return {
      address: 'proc',
      port: 0
    }
  }
  cork() {
    this._corked = true;
    this._bottle = [];
  }
  uncork() {
    if (this._corked) {
      this._corked = false;
      const b = this._bottle;
      this._bottle = null;
      b.forEach((data) => this.write(data));
    }
  }
  _pause() {
    this._paused = true;
    this._pauseBuffer = [];
  }
  _unpause() {
    if (this._paused) {
      this._paused = false;
      const b = this._pauseBuffer;
      this._pauseBuffer = null;
      b.forEach((data) => this.write(data));
    }
  }
  pipe(other) {
    this.on('data', (data) => other.write(data));
  }
}

module.exports = new Network();
