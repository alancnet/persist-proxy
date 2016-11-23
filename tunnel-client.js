const rx = require('rx');
const connect = require('./connect');

const tunnelClient = (config) => (socket) => {
  const disconnected = new rx.Subject();
  const terminated = new rx.Subject();
  const outgoing = new rx.Subject();
  connect({host: config['remote-host'], port: config['remote-port']})
    .takeUntil(disconnected)
    .repeat()
    .takeUntil(terminated)


}
