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
  userClientSocket.setNoDelay();
  const id = uuid();
  const cache = [];
  const sendQueue = new Queue();
  var packetCount = 0;
  var tunnelServer = null;
  var terminated = false;
  var lastPacketReceived = 0;

  const _send = (packet) => {
    tunnelServer.writer.writeDoubleLE(packet.sequence);
    packet.send(tunnelServer.writer);
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
    console.log("Replaying cache from ", lastReceived)
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

  userClientSocket.on('data', (buffer) => {
    const savedBuffer = Buffer.from(buffer);
    send((writer) => {
      writer.writeUInt8(consts.SEND_PACKET);
      writer.writeBuffer(savedBuffer);
    });
  });

  userClientSocket.on('end', () => {
    send((writer) => {
      writer.writeUInt8(consts.END);
    })
  })

  userClientSocket.on('error', (err) => {
    console.info(`Error on user client socket: ${err}`)
    send((writer) => {
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
        console.warn(`Packet received out of order. Waiting for replay: ${lastPacketReceived} -> ${sequence}`)
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
    userClientSocket.end();
    send((writer) => {
      writer.writeUInt8(consts.END);
    }, true);

  }

  const listenToTunnelServer = () => {
    if (tunnelServer) {
      tunnelServer.reader.readDoubleLE((sequence) => {
        if (sequence < 1) {
          // Server reports sequence out of order
          const lastReceived = -sequence;
          replayCache(lastReceived);
          listenToTunnelServer();
        } else {
          tunnelServer.reader.readUInt8((command) => {
            switch (command) {
              case consts.SEND_PACKET:
                tunnelServer.reader.readBuffer((buffer) => {
                  if (checkSequence(sequence)) {
                    onSendPacket(buffer);
                  }
                })
                break;
              case consts.ACK:
                tunnelServer.reader.readDoubleLE((ackSequence) => {
                  if (checkSequence(sequence)) {
                    onAck(ackSequence);
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

  const connectToTunnelServer = () => {
    tunnelServer = null;
    const tunnelServerSocket = net.connect({
      host: config.connectHost,
      port: config.connectPort
    }, () => {
      tunnelServerSocket.setNoDelay();
      tunnelServer = {
        socket: tunnelServerSocket,
        writer: new serialStream.SerialStreamWriter(tunnelServerSocket),
        reader: new serialStream.SerialStreamReader(tunnelServerSocket)
      };
      tunnelServer.writer.writeString(consts.HELLO);
      tunnelServer.writer.writeString(id);
      tunnelServer.reader.readString((hello) => {
        if (hello != consts.HELLO) console.error(`Invalid tunnelServer hello: ${hello}`);
        else listenToTunnelServer();
      });
      tunnelServer.writer.writeDoubleLE(-lastPacketReceived);
    });

    tunnelServerSocket.on('error', (err) => {
      console.warn(`Unable to connect to tunnelServer: ${err}`);
      tunnelServer = null;
      setTimeout(connectToTunnelServer, 1000);
    });

    tunnelServerSocket.on('end', () => {
      tunnelServer = null;
      if (!terminated) {
        setTimeout(connectToTunnelServer, 1000);
      }
    });
  };
  connectToTunnelServer();
}

module.exports = tunnelClient;
