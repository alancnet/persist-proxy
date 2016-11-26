const net = require('net');
const rx = require('rx');
const socket = require('./socket');

const connect = (config) => {
  const o = rx.Observable.create((observer) => {
    const s = net.connect(config, (err) => {
      if (err) observer.onError(err);
      else observer.onNext(socket(s));
    });
  }).flatten().share();
}

module.exports = connect;
