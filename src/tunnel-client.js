const rx = require('rx');
const net = require('net');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');
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

  console.log(`${name}: Client connected`);
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
          tunnelServer.socket.end();
        }
      }
    }
  }

  const replayCache = (lastReceived) => {
    console.log(`${name}: Replaying from ${lastReceived}`);
    cache.forEach((packet) => {
      if (packet.sequence > lastReceived) {
        _send(packet);
      }
    })
    console.log(`${name}: Stream is live`);
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
    console.log(`${name}: User client disconnected`);
    send((writer) => {
      terminated = true;
      writer.writeUInt8(consts.END);
    })
  })

  userClientSocket.on('error', (err) => {
    console.info(`Error on user client socket: ${err}`)
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
        console.warn(`${name}: Packet received out of order. Waiting for replay: ${lastPacketReceived} -> ${sequence}`)
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
    //console.log(`Cache purged from ${l} to ${cache.length}`);
  }
  const onEnd = () => {
    console.log(`${name}: Received END command. Tearing down.`);
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
        if (sequence < 1) {
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
      const hostPort = `tcp://${connect.host}:${connect.port}`;
      console.log(`${name}: Connecting to tunnelServer: ${hostPort}`);
      const tunnelServerSocket = net.connect(connect, () => {
        if (tunnelServer != null) {
          console.log(`${name}: Connected to tunnelServer, but another tunnelServer already succeeded. Disconnecting.`);
          tunnelServerSocket.end();
        } else {
          console.log(`${name}: Connected to tunnelServer: ${hostPort}`);
          tunnelServerSocket.setNoDelay();

          tunnelServer = {
            socket: tunnelServerSocket,
            writer: new serialStream.SerialStreamWriter(tunnelServerSocket),
            reader: new serialStream.SerialStreamReader(tunnelServerSocket),
            lastPong: new Date().getTime()
          };
          tunnelServer.writer.writeString(consts.HELLO);
          tunnelServer.writer.writeString(id);
          tunnelServer.reader.readString((hello) => {
            if (hello != consts.HELLO) console.error(`Invalid tunnelServer hello: ${hello}`);
            else listenToTunnelServer();
          });
          console.log(`${name}: Sending replay signal: ${lastPacketReceived}`);
          tunnelServer.writer.writeDoubleLE(-lastPacketReceived);
          const pingTimer = tunnelServer.pingTimer = setInterval(() => {
            if (!tunnelServer || tunnelServer.pingTimer !== pingTimer) {
              clearInterval(pingTimer);
            } else {
              if (tunnelServer && tunnelServer.lastPong < new Date().getTime() - 5000) {
                if (!terminated) console.log(`${name}: Ping timeout on tunnelServer: ${hostPort}`);
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
          tunnelServerSocket.on('error', (err) => {
            console.log(`${name}: Error communicating with tunnelServer: ${err}`);
            tunnelServer = null;
            if (!terminated) {
              setTimeout(connectToTunnelServer, 1000);
            }
          });

          tunnelServerSocket.on('end', () => {
            console.log(`${name}: Disconnected from tunnelServer: ${hostPort}`);
            tunnelServer = null;
            if (!terminated) {
              setTimeout(connectToTunnelServer, 1000);
            }
          });
        }
      });

      tunnelServerSocket.on('error', (err) => {
        if (tunnelServer) {
          if (tunnelServer.socket === tunnelServerSocket) {
            // Ignore, error handler for active connection specified above.
          } else {
            console.log(`${name}: Connection failed to ${hostPort}, but we're already connected on another destination.`);
          }
        } else if (!terminated) {
          console.log(`${name}: Connection failed to ${hostPort}.`);
          failCount++;
          if (failCount === config.connect.length) {
            if (config.connect.length > 1) console.log(`${name}: All destinations have failed. Attempting all again.`);
            setTimeout(connectToTunnelServer, 1000);
          }
        }
      })


    })
  };
  connectToTunnelServer();
}

module.exports = tunnelClient;
