const net = require('net');
const uuid = require('uuid');
const bind = require('./bind');
const serialStream = require('serial-stream');
const consts = require('./consts');

const reverseClient = (config) => {
  const userServerConfig = config.listen;
  const tunnelServerConfig = config.connect[0];
  const pipeConfigs = config.connect.slice(1);

  if (config.connect.length < 2) {
    console.error("Reverse client requires <user-server>:<reverse-server>:<pipe>");
    process.exit(2);
  }

  const id = uuid();
  const name = id.substr(0, 8);
  var tunnelServer;
  const userServers = {};
  const pipes = {}
  const tunnelServerSocket = net.connect(tunnelServerConfig, () => {
    tunnelServer = {
      socket: tunnelServerSocket,
      writer: new serialStream.SerialStreamWriter(tunnelServerSocket),
      reader: new serialStream.SerialStreamReader(tunnelServerSocket)
    };

    tunnelServer.socket.setNoDelay();

    tunnelServer.socket.on('error', (err) => {
      console.log(`${name}: Error on tunnel server socket: ${err}`);
      process.exit(1);
    });

    tunnelServer.socket.on('end', () => {
      console.log(`${name}: Connection to tunnel server ended.`);
      process.exit(1);
    });

    pipeConfigs.forEach((pipe) => {
      console.log(`${name}: Sending pipe endpoint ${pipe.host}:${pipe.port}`)
      pipe.id = uuid();
      tunnelServer.socket.cork();
      tunnelServer.writer.writeUInt8(consts.LISTEN);
      tunnelServer.writer.writeString(pipe.id);
      tunnelServer.writer.writeString(pipe.host);
      tunnelServer.writer.writeUInt16LE(pipe.port);
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
                  tunnelServer.reader.readUInt16LE((port) => {
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
      console.log(`${name}: Client ${id} connected on pipe ${pipeId}: tcp://${address}:${port} -> tcp://${pipes[pipeId].host}:${pipes[pipeId].port}`);
      userServer = {
        id: id,
        socket: null,
        terminated: false,
        queue: []
      };
      userServers[id] = userServer;
      const userServerSocket = net.connect(userServerConfig, () => {
        if (userServer.terminated) {
          userServerSocket.end();
        }
        userServer.socket = userServerSocket;
        userServer.socket.setNoDelay();
        userServer.socket.on('error', (err) => {
          console.error(`${name}: User server error: ${err}`);
          tunnelServer.socket.cork();
          tunnelServer.writer.writeUInt8(consts.END);
          tunnelServer.writer.writeString(userServer.id);
          tunnelServer.socket.uncork();
        });
        userServer.socket.on('end', () => {
          console.error(`${name}: User server disconnected`);
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
          console.error(`${name}: Error connecting to user server: ${err}`);
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
      console.log(`${name}: Error connecting to server: ${err}`);
      process.exit(1);
    }
  })
}

module.exports = reverseClient;
