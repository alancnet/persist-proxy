const rx = require('rx');

const socket = (socket) => rx.Observable.create((observer) => {
  observer.onNext({
    type: 'connected',
    onNext: (data) => socket.send(data),
    onError: (err) => throw err,
    onCompleted: () => socket.close()
  });

  socket.on('data', observer.onNext.bind(observer));
  socket.on('end', observer.onCompleted.bind(observer));
}).toFlush().share();
