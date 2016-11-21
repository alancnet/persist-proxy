const rx = require('rx');
const connect = require('./connect');

const userClient = (config) => (socket) => {
  const disconnected = new rx.Subject();
  const terminated = new rx.Subject();
  const outgoing = new rx.Subject();
  connect(config)
    .takeUntil(disconnected)
    .repeat()
    .takeUntil(terminated)


}
