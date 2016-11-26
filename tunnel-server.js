const rx = require('rx');
const connect = require('./connect');
const net = require('net');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');
const system = {
  sessions: {

  }
};

const tunnelServer = (config) => (tunnelClientSocket) => {
  tunnelClientSocket.setNoDelay();
  const tunnelClient = {
    socket: tunnelClientSocket,
    reader: new serialStream.SerialStreamReader(tunnelClientSocket),
    writer: new serialStream.SerialStreamWriter(tunnelClientSocket)
  };
  tunnelClient.writer.writeString(consts.HELLO);
  tunnelClient.reader.readString((hello) => {
    if (hello !== consts.HELLO) {
      console.error(`Client sent invalid hello: ${hello}`);
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
  const sendQueue = new Queue();
  const cache = [];
  const userServerQueue = new Queue();
  var lastPacketReceived = 0;
  var userServerSocket = null;
  var packetCount = 0;

  const _send = (packet) => {
    tunnelClient.writer.writeDoubleLE(packet.sequence);
    packet.send(tunnelClient.writer);
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
    }
  }
  const replayCache = (lastReceived) => {
    console.log("Replaying cache from", lastReceived);
    cache.forEach((packet) => {
      if (packet.sequence > lastReceived) {
        _send(packet);
      }
    })
    console.log("Stream is live");
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

  const begin = () => {
    tunnelClient.socket.on('error', (err) => {
      console.info(`Tunnel client error on active session: ${err}`)
      tunnelClient = null;
    })
    tunnelClient.socket.on('end', () => {
      console.info(`Tunnel client disconnected on active session`);
      tunnelClient = null;
    });
    tunnelClient.writer.writeDoubleLE(-lastPacketReceived);
    listenToTunnelClient();
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
        console.warn(`Packet received out of order. Waiting for replay: ${lastPacketReceived} -> ${sequence}`)
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
    //console.log(`Cache purged from ${l} to ${cache.length}`);
  }

  const onEnd = () => {
    userServerSocket.end();
    tunnelClient.socket.end();
    delete system.sessions[ident];
  }

  const listenToTunnelClient = () => {
    if (tunnelClient) {
      tunnelClient.reader.readDoubleLE((sequence) => {
        if (sequence < 1) {
          // Server reports sequence out of order
          const lastReceived = -sequence;
          replayCache(lastReceived);
          listenToTunnelClient();
        } else {
          tunnelClient.reader.readUInt8((command) => {
            switch (command) {
              case consts.SEND_PACKET:
                tunnelClient.reader.readBuffer((buffer) => {
                  if (checkSequence(sequence)) {
                    onSendPacket(buffer);
                  }
                })
                break;
              case consts.ACK:
                tunnelClient.reader.readDoubleLE((ackSequence) => {
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
            }
          });
        }
      })
    }
  }



  const connectToUserServer = () => {
    const newSocket = net.connect({
      host: config.connectHost,
      port: config.connectPort
    }, () => {
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
        send((writer) => {
          writer.writeUInt8(consts.END);
        }, true);
      })
      purgeUserServerQueue();
    });
    newSocket.on('error', (err) => {
      console.warn(`Unable to connect to user server: ${err}`);
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

module.exports = tunnelServer;
