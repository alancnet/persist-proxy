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

const net = require('net');

const bind = require('./bind');

const args = require('yargs-parser')(process.argv.slice(2));

const userClient = require('./user-client');

const mode = args._[0]

var mainStream;
switch (args._[0]) {
  case "client":
    mainStream = bind(args).flatMap(userClient(config));
    break;
  case "server":
    mainStream = bind(args).flatMap(tunnelServer(config));
    break;
  default:
    console.log(`
Usage: persist-proxy <mode> [options]
Modes:
  server - Accepts connections and forwards them to a server.
  client - Accepts
Options:
  --listen-host <host>
  --listen-port <port>
  --connect-host <host>
  --connect-port <port>
`);
    process.exit(1);
    break;
}

mainStream.subscribe(console.log);
