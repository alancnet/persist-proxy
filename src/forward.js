const transports = require('./transports');
const serialStream = require('serial-stream');
const uuid = require('uuid');
const consts = require('./consts')
const Queue = require('./queue');
const debug = require('./debug');


const forward = (config) => (userClientSocket) => {
  const id = uuid();
  const name = id.substr(0, 8);
  debug.log(`${name}: Client connected...`)
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
      debug.log(`${name}: User client disconnected`);
      terminated = true;
      if (userServerSocket) {
        debug.log(`${name}: Disconnecting user server`);
        userServerSocket.end();
      }
    }
  });

  userClientSocket.on('error', (err) => {
    if (!terminated) {
      terminated = true;
      debug.log(`${name}: Error with client on active connection: ${err}`);
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

  userClientSocket.on('timeout', () => {
    if (!terminated) {
      terminated = true;
      debug.log(`${name}: Timeout on userClient`);
      userClientSocket.end();
      userServerSocket.end();
    }
  });

  userClientSocket.setNoDelay();
  //userClientSocket.setKeepAlive(true, 1000);
  //userClientSocket.setTimeout(5000);

  config.connect.forEach((connect) => {
    const transport = transports.getTransport(connect.host, connect.port);
    const hostPort = transport.description;
    debug.log(`${name}: Connecting to destination: ${hostPort}`);
    const mySocket = transport.provider.connect(connect, () => {
      if (userServerSocket) {
        debug.log(`${name}: Connected to destination: ${hostPort}, but another destination already succeeded. Disconnecting.`);
        mySocket.end();
      } else {
        debug.log(`${name}: Connected to destination: ${hostPort}`)
        userServerSocket = mySocket;

        userServerSocket.on('end', () => {
          if (!terminated) {
            terminated = true;
            debug.log(`${name}: User server disconnected. Disconnecting user client.`);
            userClientSocket.end();
          }
        });
        userServerSocket.on('error', (err) => {
          if (!terminated) {
            terminated = true;
            debug.log(`${name}: Error with server on active connection: ${err}`);
            userClientSocket.end();
            userServerSocket.end();
          }
        });
        userServerSocket.on('data', (data) => {
          if (!terminated) {
            userClientSocket.write(data);
          }
        });

        // userServerSocket.on('timeout', () => {
        //   if (!terminated) {
        //     terminated = true;
        //     debug.log(`${name}: Timeout on userServer`);
        //     userClientSocket.end();
        //     userServerSocket.end();
        //   }
        // });
        //

        userServerSocket.setNoDelay();
        userServerSocket.setKeepAlive(true, 1000);
        userServerSocket.setTimeout(5000);
        flushQueue();
      }
    });
    mySocket.on('error', (err) => {
      if (userServerSocket) {
        if (userServerSocket === mySocket) {
          // Ignore, error handler for active connection specified above.
        } else {
          debug.log(`${name}: Connection failed to ${hostPort}, but we're already connected on another destination.`);
        }
      } else {
        debug.log(`${name}: Connection failed to ${hostPort}.`);
        failCount++;
        if (failCount === config.connect.length) {
          debug.log(`${name}: All destinations have failed. Disconnecting client.`);
          userClientSocket.end();
        }
      }
    })
  })
}

module.exports = forward;
