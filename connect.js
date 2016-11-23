const net = require('net');
const rx = require('rx');

const connect = (config) => {
  const o = rx.Observable.create((observer) => {
    const client = net.connect(config, (err) => {
      if (err) observer.onError(err);
      else {
        observer.onNext({
          type: 'connected',
          onNext: (data) => client.send(data),
          onError: (err) => throw err,
          onCompleted: () => client.close()
        });
      }
    };
    
    client.on('data', observer.onNext.bind(observer));
    client.on('end', observer.onCompleted.bind(observer));
  });
}

module.exports = connect;
