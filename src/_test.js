const vn = require('./virtual-net');
s = vn.createServer((socket) => {
  socket.write("Hello from server");
  socket.on('data', (data) => console.log(data));
});

s.listen(123, "hello");

const socket = vn.connect({host: 'hello', port: 123}, () => {
  socket.write("Hello from client");
})
socket.on('error', (err) => console.log(err));
socket.on('data', (data) => console.log(data));
