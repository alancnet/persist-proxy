const rx = require('rx');
const net = require('net');

const bind = (config) => rx.Observable.create(observer => {
  const port = (config && config['listen-port']) || 5150;
  const host = (config && config['listen-host']) || '0.0.0.0';
  const onServerListening = () => {
    console.info(`Listening on tcp://${host}:${port}`);
  };
  const server = net.createServer((s) => observer.onNext(s));
  server.on('error', observer.onError.bind(observer));
  server.on('listening', onServerListening);
  server.listen(port, host);
  const shutdown = () => {
    server.close();
  };
  return shutdown;
});

module.exports = bind
