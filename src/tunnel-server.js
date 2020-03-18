const rx = require('rx');
const transports = require('./transports');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');
const debug = require('./debug');
const system = {
  sessions: {

  }
};

const tunnelServer = (config) => (tunnelClientSocket) => {
  const name = "--------"
  debug.log(`${name}: Client connected...`)
  tunnelClientSocket.setNoDelay();
  const tunnelClient = {
    socket: tunnelClientSocket,
    reader: new serialStream.SerialStreamReader(tunnelClientSocket),
    writer: new serialStream.SerialStreamWriter(tunnelClientSocket)
  };
  tunnelClient.writer.writeString(consts.HELLO);
  tunnelClient.reader.readString((hello) => {
    if (hello !== consts.HELLO) {
      debug.error(`Client sent invalid hello: ${hello}`);
      tunnelClient.socket.end();
    } else {
      tunnelClient.reader.readString((ident) => {
        if (system.sessions.hasOwnProperty(ident)) {
          // Resuming sessions
          system.sessions[ident].resume(tunnelClient);
        } else {
          // New sessions
          system.sessions[ident] = session(ident, tunnelClient, config);
        }
      })
    }
  })
};

const session = (ident, tunnelClient, config) => {
  const name = ident.substr(0,8);
  const sendQueue = new Queue();
  const cache = [];
  const userServerQueue = new Queue();
  var lastPacketReceived = 0;
  var userServerSocket = null;
  var packetCount = 0;
  var terminated = false;
  var isNew = true;

  debug.log(`${name}: New session started`);

  const _send = (packet) => {
    const tc = tunnelClient; // Saved because this gets erased on error
    tc.writer.writeDoubleLE(packet.sequence);
    tc.socket.cork();
    packet.send(tc.writer);
    tc.socket.uncork();
    cache.push(packet);
  }

  const purgeQueue = () => {
    if (tunnelClient) {
      while (sendQueue.length) {
        const packet = sendQueue.shift();
        _send(packet);
      }
    }
  }

  const purgeUserServerQueue = () => {
    if (userServerSocket) {
      while (userServerQueue.length) {
        userServerSocket.write(userServerQueue.shift());
      }
      if (terminated) {
        userServerSocket.end()
        userServerSocket = null;
      }
    }
  }
  const replayCache = (lastReceived) => {
    if (isNew && lastReceived > 0) {
      debug.error(`${name}: Unknown continued session attempting to replay from ${lastReceived}. Tearing down.`);
      if (tunnelClient) {
        tunnelClient.writer.writeDoubleLE(Number.POSITIVE_INFINITY);
        terminated = true;
        setImmediate(() => {
          if (userServerSocket) userServerSocket.end();
          if (tunnelClient) tunnelClient.socket.end();
          delete system.sessions[ident];
        });
      }
    } else {
      isNew = false;
      debug.log(`${name}: Replaying from ${lastReceived}`);
      cache.forEach((packet) => {
        if (packet.sequence > lastReceived) {
          _send(packet);
        }
      })
      debug.log(`${name}: Stream is live`);
      purgeQueue();
    }
  }

  const send = (sendFn, terminal) => {
    sendQueue.push({
      sequence: ++packetCount,
      send: sendFn,
      terminal: !!terminal
    });
    purgeQueue();
  }

  const begin = () => {
    tunnelClient.socket.on('error', (err) => {
      if (!terminated) debug.info(`${name}: Tunnel client error on active session: ${err}`)
      tunnelClient = null;
    })
    tunnelClient.socket.on('end', () => {
      if (!terminated) debug.info(`${name}: Tunnel client disconnected on active session`);
      tunnelClient = null;
    });
    tunnelClient.writer.writeDoubleLE(-lastPacketReceived);
    listenToTunnelClient();
    const pingTimer = tunnelClient.pingTimer = setInterval(() => {
      if (!tunnelClient || tunnelClient.pingTimer !== pingTimer) {
        clearInterval(pingTimer);
      } else {
        if (tunnelClient && tunnelClient.lastPong < new Date().getTime() - 5000) {
          if (!terminated) debug.log(`${name}: Ping timeout on tunnelClient`);
          tunnelClient = null;
        } else {
          send((writer) => {
            writer.writeUInt8(consts.PING);
          });
        }
      }
    }, 1000)
  }


  const checkSequence = (sequence) => {
    if (sequence == lastPacketReceived + 1) {
      lastPacketReceived = sequence;
      if (sequence % 10 == 0) {
        send((writer) => {
          writer.writeUInt8(consts.ACK);
          writer.writeDoubleLE(lastPacketReceived);
        });
      }
      listenToTunnelClient();
      return true;
    } else {
      if (tunnelClient) {
        debug.warn(`${name}: Packet received out of order. Waiting for replay: ${lastPacketReceived} -> ${sequence}`)
        listenToTunnelClient();
        return false;
      }
    }
  }

  const onSendPacket = (buffer) => {
    userServerQueue.push(Buffer.from(buffer));
    purgeUserServerQueue();
  }
  const onAck = (ackSequence) => {
    const l = cache.length;
    while (cache.length && cache[0].sequence <= ackSequence) {
      cache.shift();
    }
    //debug.log(`Cache purged from ${l} to ${cache.length}`);
  }

  const onEnd = () => {
    debug.log(`${name}: Received END command. Tearing down.`);
    terminated = true;
    if (userServerSocket) userServerSocket.end();
    if (tunnelClient) tunnelClient.socket.end();
    delete system.sessions[ident];
  }

  const onPing = () => {
    send((writer) => {
      writer.writeUInt8(consts.PONG);
    });
  };

  const onPong = () => {};

  const listenToTunnelClient = () => {
    if (tunnelClient) {
      tunnelClient.reader.readDoubleLE((sequence) => {
        if (sequence < 1) {
          // Server reports sequence out of order
          const lastReceived = -sequence;
          replayCache(lastReceived);
          listenToTunnelClient();
        } else {
          if (tunnelClient) tunnelClient.reader.readUInt8((command) => {
            if (tunnelClient) tunnelClient.lastPong = new Date().getTime();
            switch (command) {
              case consts.SEND_PACKET:
                if (tunnelClient) tunnelClient.reader.readBuffer((buffer) => {
                  if (checkSequence(sequence)) {
                    onSendPacket(buffer);
                  }
                })
                break;
              case consts.ACK:
                if (tunnelClient) tunnelClient.reader.readDoubleLE((ackSequence) => {
                  if (checkSequence(sequence)) {
                    onAck(ackSequence)
                  }
                })
                break;
              case consts.END:
                if (checkSequence(sequence)) {
                  onEnd();
                }
                break;
              case consts.PING:
                if (checkSequence(sequence)) {
                    onPing();
                }
                break;
              case consts.PONG:
                if (checkSequence(sequence)) {
                    onPong();
                }
                break;
            }
          });
        }
      })
    }
  }



  const connectToUserServer = () => {
    const transport = transports.getTransport(config.connect[0].host, config.connect[0].port);
    const hostPort = transport.description;
    debug.log(`${name}: Connecting to user server: ${hostPort}`);
    const newSocket = transport.provider.connect(config.connect[0], () => {
      if (terminated) {
        debug.log(`${name}: Connected to user server on terminated connection. Disconnecting: ${hostPort}`);
        newSocket.end();
      } else {
        debug.log(`${name}: Connected to user server: ${hostPort}`);
        // success
        userServerSocket = newSocket;
        userServerSocket.setNoDelay();
        userServerSocket.on('data', (buffer) => {
          const savedBuffer = Buffer.from(buffer);
          send((writer) => {
            writer.writeUInt8(consts.SEND_PACKET);
            writer.writeBuffer(savedBuffer);
          });
        })
        userServerSocket.on('end', () => {
          debug.log(`${name}: User server disconnected`);
          send((writer) => {
            writer.writeUInt8(consts.END);
          }, true);
        })
        purgeUserServerQueue();
      }
    });
    newSocket.on('error', (err) => {
      debug.warn(`Unable to connect to user server: ${err}`);
      send((writer) => {
        writer.writeUInt8(consts.END);
      }, true);

    })
  }

  connectToUserServer();

  begin();

  return {
    resume: (newTunnelClient) => {
      tunnelClient = newTunnelClient;
      begin();
    }
  };
}

tunnelServer._system = system;
module.exports = tunnelServer;
