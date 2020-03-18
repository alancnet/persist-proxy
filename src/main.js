/*
  definition of terms:

  bind: Listen on a port and emit sockets
  socket: an active connection to some remote
  server: AMBIGUOUS - The listener of connections
  client: AMBIGUOUS - The initiator of the connection
  peer: either the client or the server on a socket
  userClient (or UC): The software on the outside that is oblivious to this process
    that is connecting to the tunnelServer
  userServer (or US): The software on the outside that is oblivious to this process
    that is listening for connections
  tunnelClient (or TC): This software on the tunnelClient side that pretends
    to be a server, but resolves the connection with a tunnel
  tunnelServer (or TS): This software on the tunnelServer side that
    pretents to be a client connecting to the tunnelServer.
  tunnel: The sum of all parts connecting the tunnelClient with the tunnelServer

*/

const bind = require('../src/bind');
function main(argv) {
  const debug = require('./debug');
  const args = require('yargs-parser')(argv);
  const tunnelClient = require('./tunnel-client');
  const tunnelServer = require('./tunnel-server');
  const reverseClient = require('./reverse-client');
  const reverseServer = require('./reverse-server');
  const forward = require('./forward');
  const transports = require('./transports');

  const toArray = (v) => v === undefined ? [] : v instanceof Array ? v : [v];
  const parseAddress = (addr) => {
    const words = (addr.toString()).split(':');
    if (words.length % 2 == 1) words.unshift('0.0.0.0');
    const ret = {
      listen: {
        host: words[0],
        port: parseInt(words[1]) || words[1]
      },
      connect: []
    };
    for (var i = 2; i < words.length; i+= 2) {
      ret.connect.push({
        host: words[i],
        port: words[i+1]
      });
    }
    return ret;
  }

  toArray(args.client)
    .map(parseAddress)
    .forEach((config) => {
      bind(config.listen)
      .forEach(tunnelClient(config))
      debug.log(`Tunnel client listening on ${transports.getTransport(config.listen.host, config.listen.port)}`);
    })

  toArray(args.server)
    .map(parseAddress)
    .forEach((config) => {
      bind(config.listen)
      .forEach(tunnelServer(config))
      debug.log(`Tunnel server listening on ${transports.getTransport(config.listen.host, config.listen.port)}`);
    })

  toArray(args.forward)
    .map(parseAddress)
    .forEach((config) => {
      bind(config.listen)
      .forEach(forward(config))
      debug.log(`Port forwarder listening on ${transports.getTransport(config.listen.host, config.listen.port)}`);
    })

  toArray(args['reverse-server'])
    .map(parseAddress)
    .forEach((config) => {
      bind(config.listen)
      .forEach(reverseServer(config))
      debug.log(`Reverse server listening on ${transports.getTransport(config.listen.host, config.listen.port)}`);
    })

  toArray(args['reverse-client'])
    .map(parseAddress)
    .forEach((config) => {
      reverseClient(config)
    })

  switch (args._[0]) {
    case "client":
      bind(args)
        .forEach(tunnelClient({
          connectHost: args['connect-host'],
          connectPort: args['connect-port']
        }));
      break;
    case "server":
      bind(args)
        .forEach(tunnelServer({
          connectHost: args['connect-host'],
          connectPort: args['connect-port']
        }));
      break;
  }

  if (args.help) {
    debug.log(`
  Usage: persist-proxy [options]

  Options:
    --client [listen-host:]listen-port:host:port
    --server [listen-host:]listen-port:service-host:service-port
    --forward [listen-host:]listen-port:host:port[:host:port...]
    --reverse-server [listen-host:]listen-port
    --reverse-client service-host:service-port:host:port:listen-host:listen-port

      listen-host  - A local address to bind to for incoming connections.
      listen-port  - A local port for listen-host.
      host         - A remote host running with --server or --reverse-server.
      port         - A remote port for host.
      service-host - A local or remote host to the service you are proxying.
      service-port - A remote port for service-host.

  Example:
    persist-proxy --server 30001:127.0.0.1:80
    persist-proxy --client 8080:123.45.6.78:30001

    persist-proxy --server 172.20.0.1:30000:172.20.0.100:80
    persist-proxy --client 0.0.0.0:8080:172.20.0.1:30000
    `);
    process.exit(1);
  }
}


module.exports = main;
