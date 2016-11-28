const net = require('net');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');


const forward = (config) => (userClientSocket) => {
  const id = uuid();
  const name = id.substr(0, 8);
  console.log(`${name}: Client connected...`)
  var userServerSocket = null;
  var terminated = false;
  var failCount = 0;
  const sendQueue = new Queue();

  const flushQueue = () => {
    if (userServerSocket) {
      while (sendQueue.length) {
        userServerSocket.write(sendQueue.shift());
      }
    }
  };

  userClientSocket.on('end', () => {
    if (!terminated) {
      console.log(`${name}: User client disconnected`);
      terminated = true;
      if (userServerSocket) {
        console.log(`${name}: Disconnecting user server`);
        userServerSocket.end();
      }
    }
  });

  userClientSocket.on('error', (err) => {
    if (!terminated) {
      terminated = true;
      console.log(`${name}: Error with client on active connection: ${err}`);
      userClientSocket.end();
      userServerSocket.end();
    }
  });

  userClientSocket.on('data', (data) => {
    if (!terminated) {
      if (userServerSocket) {
        userServerSocket.write(data);
      } else {
        sendQueue.push(Buffer.from(data));
      }
    }
  });

  userClientSocket.setNoDelay();

  config.connect.forEach((connect) => {
    const hostPort = `tcp://${connect.host}:${connect.port}`;
    console.log(`${name}: Connecting to destination: ${hostPort}`);
    const mySocket = net.connect(connect, () => {
      if (userServerSocket) {
        console.log(`${name}: Connected to destination: ${hostPort}, but another destination already succeeded. Disconnecting.`);
        mySocket.end();
      } else {
        console.log(`${name}: Connected to destination: ${hostPort}`)
        userServerSocket = mySocket;

        userServerSocket.on('end', () => {
          if (!terminated) {
            terminated = true;
            console.log(`${name}: User server disconnected. Disconnecting user client.`);
            userClientSocket.end();
          }
        });
        userServerSocket.on('error', (err) => {
          if (!terminated) {
            terminated = true;
            console.log(`${name}: Error with server on active connection: ${err}`);
            userClientSocket.end();
            userServerSocket.end();
          }
        });
        userServerSocket.on('data', (data) => {
          if (!terminated) {
            userClientSocket.write(data);
          }
        });

        userServerSocket.setNoDelay();
        flushQueue();
      }
    });
    mySocket.on('error', (err) => {
      if (userServerSocket) {
        if (userServerSocket === mySocket) {
          // Ignore, error handler for active connection specified above.
        } else {
          console.log(`${name}: Connection failed to ${hostPort}, but we're already connected on another destination.`);
        }
      } else {
        console.log(`${name}: Connection failed to ${hostPort}.`);
        failCount++;
        if (failCount === config.connect.length) {
          console.log(`${name}: All destinations have failed. Disconnecting client.`);
          userClientSocket.end();
        }
      }
    })
  })
}

module.exports = forward;
