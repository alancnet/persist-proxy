const net = require('net');
const virtualNet = require('./virtual-net');

function getTransport(host, port) {
  if (host == 'proc') {
    return {
      type: 'proc',
      description: `proc://${host}:${port}`,
      host: host,
      port: port,
      provider: virtualNet,
      toString: function() { return this.description; }
    }
  }
  return {
    type: 'tcp',
    description: `tcp://${host}:${port}`,
    host: host,
    port: port,
    provider: net,
    toString: function() { return this.description; }
  }

}


module.exports = {getTransport};
