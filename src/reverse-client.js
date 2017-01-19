const transports = require('./transports');
const uuid = require('uuid');
const serialStream = require('serial-stream');
const consts = require('./consts');
const debug = require('./debug');

const reverseClient = (config) => {
  const userServerConfig = config.listen;
  const tunnelServerConfig = config.connect[0];
  const pipeConfigs = config.connect.slice(1);

  if (config.connect.length < 2) {
    debug.error("Reverse client requires <user-server>:<reverse-server>:<pipe>");
    process.exit(2);
  }

  const id = uuid();
  const name = id.substr(0, 8);
  var tunnelServer;
  const userServers = {};
  const pipes = {}
  const transport = transports.getTransport(tunnelServerConfig.host, tunnelServerConfig.port);
  const tunnelServerSocket = transport.provider.connect(tunnelServerConfig, () => {
    tunnelServer = {
      socket: tunnelServerSocket,
      writer: new serialStream.SerialStreamWriter(tunnelServerSocket),
      reader: new serialStream.SerialStreamReader(tunnelServerSocket)
    };

    tunnelServer.socket.setNoDelay();

    const tearDownAndRestart = () => {
      Object.keys(userServers).forEach((id) => {
        const userServer = userServers[id];
        if (userServer.socket) {
          debug.log(`${userServer.name}: Disconnecting bifurcated connection.`);
          userServer.socket.end();
        }
      });
      setTimeout(() => {
        reverseClient(config);
      }, 1000);
    }

    tunnelServer.socket.on('error', (err) => {
      debug.log(`${name}: Error on tunnel server socket: ${err}`);
      tearDownAndRestart();
    });

    tunnelServer.socket.on('end', () => {
      debug.log(`${name}: Connection to tunnel server ended.`);
      tearDownAndRestart();
    });

    pipeConfigs.forEach((pipe) => {
      debug.log(`${name}: Sending pipe endpoint ${pipe.host}:${pipe.port}`)
      pipe.id = uuid();
      tunnelServer.socket.cork();
      tunnelServer.writer.writeUInt8(consts.LISTEN);
      tunnelServer.writer.writeString(pipe.id);
      tunnelServer.writer.writeString(pipe.host);
      tunnelServer.writer.writeString(pipe.port.toString());
      tunnelServer.socket.uncork();
      pipes[pipe.id] = pipe;
    })

    const readCommand = () => {
      tunnelServer.reader.readUInt8().then((command) => {
        switch (command) {
          case consts.CLIENT_CONNECT:
            tunnelServer.reader.readString((pipeId) =>
              tunnelServer.reader.readString((id) =>
                tunnelServer.reader.readString((address) =>
                  tunnelServer.reader.readString((port) => {
                    onClientConnect(pipeId, id, address, port);
                    readCommand();
                  })
                )
              )
            )
            break;
          case consts.SEND_PACKET:
            tunnelServer.reader.readString((id) =>
              tunnelServer.reader.readBuffer((buffer) => {
                onSendPacket(id, buffer);
                readCommand();
              })
            )
            break;
          case consts.END:
            tunnelServer.reader.readString((id) => {
              onEnd(id);
              readCommand();
            })
            break;
        }
      })
    };

    const onSendPacket = (id, buffer) => {
      const userServer = userServers[id];
      if (userServer) {
        if (userServer.socket) {
          userServer.socket.write(buffer);
        } else {
          userServer.queue.push(buffer);
        }
      }
    }

    const onEnd = (id) => {
      const userServer = userServers[id];
      if (userServer) {
        userServer.terminated = true;
        if (userServer.socket) {
          userServer.socket.end();
        }
        delete userServers[id];
      }
    }

    const onClientConnect = (pipeId, id, address, port) => {
      debug.log(`${name}: Client ${id.substr(0, 8)} connected on pipe ${pipeId}: tcp://${address}:${port} -> tcp://${pipes[pipeId].host}:${pipes[pipeId].port}`);
      const userServer = {
        id: id,
        name: id.substr(0, 8),
        socket: null,
        terminated: false,
        queue: []
      };
      userServers[id] = userServer;
      const transport = transports.getTransport(userServerConfig.host, userServerConfig.port);
      const userServerSocket = transport.provider.connect(userServerConfig, () => {
        if (userServer.terminated) {
          userServerSocket.end();
        }
        userServer.socket = userServerSocket;
        userServer.socket.setNoDelay();
        userServer.socket.on('error', (err) => {
          debug.error(`${name}: User server error: ${err}`);
          tunnelServer.socket.cork();
          tunnelServer.writer.writeUInt8(consts.END);
          tunnelServer.writer.writeString(userServer.id);
          tunnelServer.socket.uncork();
        });
        userServer.socket.on('end', () => {
          debug.error(`${name}: User server disconnected`);
          tunnelServer.socket.cork();
          tunnelServer.writer.writeUInt8(consts.END);
          tunnelServer.writer.writeString(userServer.id);
          tunnelServer.socket.uncork();
        });
        userServer.socket.on('data', (buffer) => {
          tunnelServer.socket.cork();
          tunnelServer.writer.writeUInt8(consts.SEND_PACKET);
          tunnelServer.writer.writeString(userServer.id);
          tunnelServer.writer.writeBuffer(buffer);
          tunnelServer.socket.uncork();
        })
        userServer.queue.forEach((buffer) => {
          userServer.socket.write(buffer);
        })
        userServer.queue = null;

      });
      userServerSocket.on('error', (err) => {
        if (!userServer.socket) {
          debug.error(`${name}: Error connecting to user server: ${err}`);
          tunnelServer.socket.cork();
          tunnelServer.writer.writeUInt8(consts.END);
          tunnelServer.writer.writeString(userServer.id);
          tunnelServer.socket.uncork();
        }
      })
    }
    readCommand();
  });

  tunnelServerSocket.on('error', (err) => {
    if (!tunnelServer) {
      debug.log(`${name}: Error connecting to server: ${err}`);
      tearDownAndRestart();
    }
  })
}

module.exports = reverseClient;
