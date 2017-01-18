const transports = require('./transports');
const uuid = require('uuid');
const bind = require('./bind');
const serialStream = require('serial-stream');
const consts = require('./consts');

const reverseServer = (config) => (tunnelClientSocket) => {
  const id = uuid();
  const name = id.substr(0,8);
  console.log(`${name}: Tunnel client connected.`)
  const tunnelClient = {
    socket: tunnelClientSocket,
    writer: new serialStream.SerialStreamWriter(tunnelClientSocket),
    reader: new serialStream.SerialStreamReader(tunnelClientSocket)
  };
  const userClients = {};
  const pipes = {};
  const readCommand = () => {
    tunnelClient.socket.setNoDelay();
    tunnelClient.reader.readUInt8((command) => {
      switch (command) {
        case consts.LISTEN:
          tunnelClient.reader.readString((pipeId) =>
            tunnelClient.reader.readString((pipeHost) =>
              tunnelClient.reader.readUInt16LE((pipePort) => {
                onListen(pipeId, pipeHost, pipePort);
                readCommand();
              })
            )
          )
          break;
        case consts.SEND_PACKET:
          tunnelClient.reader.readString((clientId) =>
            tunnelClient.reader.readBuffer((buffer) => {
              onSendPacket(clientId, buffer)
              readCommand();
            })
          )
          break;
        case consts.END:
          tunnelClient.reader.readString((clientId) => {
            onEnd(clientId);
            readCommand();
          });
          break;
      }
    });
  }

  const tearDown = () => {
    Object.keys(pipes).forEach((id) => pipes[id].bound.dispose());
    Object.keys(userClients).forEach((id) => {
      const socket = userClients[id].socket;
      if (socket) {
        socket.end()
      }
    });
  };

  tunnelClient.socket.on('error', (err) => {
    console.log(`${name}: Error on tunnel client socket: ${err}`)
    tearDown();
  });

  tunnelClient.socket.on('end', () => {
    console.log(`${name}: Tunnel client disconnected.`);
    tearDown();
  })

  const onSendPacket = (id, buffer) => {
    const userClient = userClients[id];
    if (userClient) {
      userClient.socket.write(buffer);
    } else {
      console.warn(`${name}: Received SEND_PACKET from tunnelClient for non-existent userClient: ${id}`);
    }
  };

  const onEnd = (id) => {
    const userClient = userClients[id];
    if (userClient) {
      console.log(`${name}:${userClient.pipe.name}:${userClient.name}: Received END from tunnelClient.`);
      userClient.socket.end();
      delete userClients[id];
    } else {
      console.warn(`${name}: Received END from tunnelClient for non-existent userClient: ${id}`);
    }
  };

  const onListen = (pipeId, pipeHost, pipePort) => {
    const pipe = {
      id: pipeId,
      name: pipeId.substr(0, 8),
      host: pipeHost,
      port: pipePort,
      pipe: `tcp://${pipeHost}:${pipePort}`
    };
    pipes[pipe.id] = pipe;
    console.log(`${name}:${pipe.name}: Listening on ${pipe.pipe}`)
    pipe.bound = bind(pipe)
      .subscribe((userClientSocket) =>
        {
          const userClientId = uuid();
          const userClientSocketAddress = userClientSocket.address();
          const userClient = {
            id: userClientId,
            name: userClientId.substr(0, 8),
            socket: userClientSocket,
            address: userClientSocketAddress,
            pipe: pipe,
            tunnel: `tcp://${userClientSocketAddress.address}:${userClientSocketAddress.port} -> ${pipe.pipe}`
          };
          userClient.socket.setNoDelay();
          userClient.name = userClient.id.substr(0, 8);
          console.log(`${name}:${pipe.name}${userClient.name}: User client connected: ${userClient.tunnel}`)
          userClients[userClient.id] = userClient;

          tunnelClient.socket.cork();
          tunnelClient.writer.writeUInt8(consts.CLIENT_CONNECT);
          tunnelClient.writer.writeString(pipe.id);
          tunnelClient.writer.writeString(userClient.id);
          tunnelClient.writer.writeString(userClient.socket.address().address);
          tunnelClient.writer.writeUInt16LE(userClient.socket.address().port);
          tunnelClient.socket.uncork();

          userClient.socket.on('error', (err) => {
            console.log((`${name}:${pipe.name}${userClient.name}: User client socket error: ${err}`))
            tunnelClient.socket.cork();
            tunnelClient.writer.writeUInt8(consts.END);
            tunnelClient.writer.writeString(userClient.id);
            tunnelClient.socket.uncork();
            delete userClients[pipe.id];
          });
          userClient.socket.on('end', () => {
            console.log((`${name}:${pipe.name}${userClient.name}: User client disconnected`))
            tunnelClient.socket.cork();
            tunnelClient.writer.writeUInt8(consts.END);
            tunnelClient.writer.writeString(userClient.id);
            tunnelClient.socket.uncork();
            delete userClients[pipe.id];
          });

          userClient.socket.on('data', (buffer) => {
            tunnelClient.socket.cork();
            tunnelClient.writer.writeUInt8(consts.SEND_PACKET);
            tunnelClient.writer.writeString(userClient.id);
            tunnelClient.writer.writeBuffer(buffer);
            tunnelClient.socket.uncork();
          })
        }, (err) => {
          console.error((`${name}:${pipe.name}: Error listening on pipe: ${err}`))
          tunnelClient.socket.end();
        }
      );
  }
  readCommand();
}


module.exports = reverseServer;
