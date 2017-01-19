const rx = require('rx');
const transports = require('./transports');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');
const debug = require('./debug');

// config:
//   connectHost
//   connectPort
const tunnelClient = (config) => (userClientSocket) => {
  const id = uuid();
  const name = id.substr(0,8);
  const cache = [];
  const sendQueue = new Queue();
  var packetCount = 0;
  var tunnelServer = null;
  var terminated = false;
  var lastPacketReceived = 0;

  userClientSocket.setNoDelay();

  debug.log(`${name}: Client connected`);
  const _send = (packet) => {
    const ts = tunnelServer; // Save because this gets erased on error
    ts.writer.writeDoubleLE(packet.sequence);
    ts.socket.cork();
    packet.send(ts.writer);
    ts.socket.uncork();
    cache.push(packet);
  }

  const purgeQueue = () => {
    if (tunnelServer) {
      while (sendQueue.length) {
        const packet = sendQueue.shift();
        _send(packet);
        if (packet.terminal) {
          terminated = true;
          if (tunnelServer) tunnelServer.socket.end();
        }
      }
    }
  }

  const replayCache = (lastReceived) => {
    debug.log(`${name}: Replaying from ${lastReceived}`);
    cache.forEach((packet) => {
      if (packet.sequence > lastReceived) {
        _send(packet);
      }
    })
    debug.log(`${name}: Stream is live`);
    purgeQueue();
  }

  const send = (sendFn, terminal) => {
    sendQueue.push({
      sequence: ++packetCount,
      send: sendFn,
      terminal: !!terminal
    });
    purgeQueue();
  }

  userClientSocket.on('data', (buffer) => {
    const savedBuffer = Buffer.from(buffer);
    send((writer) => {
      writer.writeUInt8(consts.SEND_PACKET);
      writer.writeBuffer(savedBuffer);
    });
  });

  userClientSocket.on('end', () => {
    debug.log(`${name}: User client disconnected`);
    send((writer) => {
      terminated = true;
      writer.writeUInt8(consts.END);
    })
  })

  userClientSocket.on('error', (err) => {
    debug.info(`Error on user client socket: ${err}`)
    send((writer) => {
      terminated = true;
      writer.writeUInt8(consts.END);
    })
  })



  const checkSequence = (sequence) => {
    if (sequence == lastPacketReceived + 1) {
      lastPacketReceived = sequence;
      if (sequence % 10 == 0) {
        send((writer) => {
          writer.writeUInt8(consts.ACK);
          writer.writeDoubleLE(lastPacketReceived);
        });
      }
      listenToTunnelServer();
      return true;
    } else {
      if (tunnelServer) {
        debug.warn(`${name}: Packet received out of order. Waiting for replay: ${lastPacketReceived} -> ${sequence}`)
        listenToTunnelServer();
        return false;
      }
    }
  }

  const onSendPacket = (buffer) => {
    userClientSocket.write(buffer);
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
    userClientSocket.end();
    send((writer) => {
      writer.writeUInt8(consts.END);
    }, true);

  }

  const onPing = () => {
    send((writer) => {
      writer.writeUInt8(consts.PONG);
    });
  };

  const onPong = () => {};

  const listenToTunnelServer = () => {
    if (tunnelServer) {
      tunnelServer.reader.readDoubleLE((sequence) => {
        if (sequence == Number.POSITIVE_INFINITY) {
          // Server reports unknown session
          debug.log(`${name}: Server reports unknown session. Tearing down.`);
          terminated = true;
          userClientSocket.end();
        } else if (sequence < 1) {
          // Server reports sequence out of order
          const lastReceived = -sequence;
          replayCache(lastReceived);
          listenToTunnelServer();
        } else {
          if (tunnelServer) tunnelServer.reader.readUInt8((command) => {
            if (tunnelServer) tunnelServer.lastPong = new Date().getTime();
            switch (command) {
              case consts.SEND_PACKET:
                if (tunnelServer) tunnelServer.reader.readBuffer((buffer) => {
                  if (checkSequence(sequence)) {
                    onSendPacket(buffer);
                  }
                })
                break;
              case consts.ACK:
                if (tunnelServer) tunnelServer.reader.readDoubleLE((ackSequence) => {
                  if (checkSequence(sequence)) {
                    onAck(ackSequence);
                  }
                })
                break;
              case consts.END:
                if (checkSequence(sequence)) {
                  onEnd();
                }
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

  var failCount = 0;
  const connectToTunnelServer = () => {
    tunnelServer = null;
    failCount = 0;
    config.connect.forEach((connect) => {
      const transport = transports.getTransport(connect.host, connect.port);
      const hostPort = transport.description;
      debug.log(`${name}: Connecting to tunnelServer: ${hostPort}`);
      const tunnelServerSocket = transport.provider.connect(connect, () => {
        if (tunnelServer != null) {
          debug.log(`${name}: Connected to tunnelServer, but another tunnelServer already succeeded. Disconnecting.`);
          tunnelServerSocket.end();
        } else {
          debug.log(`${name}: Connected to tunnelServer: ${hostPort}`);
          tunnelServerSocket.setNoDelay();

          const newTunnelServer = {
            socket: tunnelServerSocket,
            writer: new serialStream.SerialStreamWriter(tunnelServerSocket),
            reader: new serialStream.SerialStreamReader(tunnelServerSocket),
            lastPong: new Date().getTime()
          };
          newTunnelServer.writer.writeString(consts.HELLO);
          newTunnelServer.reader.readString((hello) => {
            if (hello != consts.HELLO) debug.error(`Invalid tunnelServer hello: ${hello}`);
            else {
              if (tunnelServer != null) {
                debug.log(`${name}: Handshake to tunnelServer, but another tunnelServer already succeeded. Disconnecting.`);
                tunnelServerSocket.end();
              } else {
                newTunnelServer.writer.writeString(id);
                debug.log(`${name}: Handshake to tunnelServer succeeded.`);
                tunnelServer = newTunnelServer
                listenToTunnelServer();
                debug.log(`${name}: Sending replay signal: ${lastPacketReceived}`);
                tunnelServer.writer.writeDoubleLE(-lastPacketReceived);
                const pingTimer = tunnelServer.pingTimer = setInterval(() => {
                  if (!tunnelServer || tunnelServer.pingTimer !== pingTimer) {
                    clearInterval(pingTimer);
                  } else {
                    if (tunnelServer && tunnelServer.lastPong < new Date().getTime() - 5000) {
                      if (!terminated) debug.log(`${name}: Ping timeout on tunnelServer: ${hostPort}`);
                      tunnelServer = null;
                      if (!terminated) {
                        setTimeout(connectToTunnelServer, 1000);
                      }
                    } else {
                      send((writer) => {
                        writer.writeUInt8(consts.PING);
                      });
                    }
                  }
                }, 1000)
              }
            }
          });
          tunnelServerSocket.on('error', (err) => {
            debug.log(`${name}: Error communicating with tunnelServer: ${err}`);
            if (tunnelServer == newTunnelServer) {
              tunnelServer = null;
              if (!terminated) {
                setTimeout(connectToTunnelServer, 1000);
              }
            }
          });

          tunnelServerSocket.on('end', () => {
            debug.log(`${name}: Disconnected from tunnelServer: ${hostPort}`);
            if (tunnelServer == newTunnelServer) {
              tunnelServer = null;
              if (!terminated) {
                setTimeout(connectToTunnelServer, 1000);
              }
            }
          });
        }
      });

      tunnelServerSocket.on('error', (err) => {
        if (tunnelServer) {
          if (tunnelServer.socket === tunnelServerSocket) {
            // Ignore, error handler for active connection specified above.
          } else {
            debug.log(`${name}: Connection failed to ${hostPort}, but we're already connected on another destination.`);
          }
        } else if (!terminated) {
          debug.log(`${name}: Connection failed to ${hostPort}.`);
          failCount++;
          if (failCount === config.connect.length) {
            if (config.connect.length > 1) debug.log(`${name}: All destinations have failed. Attempting all again.`);
            setTimeout(connectToTunnelServer, 1000);
          }
        }
      })


    })
  };
  connectToTunnelServer();
}

module.exports = tunnelClient;
