const rx = require('rx');
const transports = require('./transports');
const debug = require('./debug');

const bind = (config) => rx.Observable.create(observer => {
  const port = (config && config.port) || 5150;
  const host = (config && config.host) || '0.0.0.0';
  const transport = transports.getTransport(host, port);
  const onServerListening = () => {
    debug.info(`Listening on ${transport}`);
  };
  const server = transport.provider.createServer((s) => observer.onNext(s));
  server.on('error', observer.onError.bind(observer));
  server.on('listening', onServerListening);
  server.listen(port, host);
  const shutdown = () => {
    server.close();
  };
  return shutdown;
});

module.exports = bind
