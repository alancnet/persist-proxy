const net = require('net');
const virtualNet = require('./virtual-net');
const wssNet = require('./wss-net')

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
  if (host.startsWith('wss://')) {
    const parts = host.split('/')
    return {
      type: 'wss',
      description: host,
      host: parts[2],
      port: parts.slice(3).join('/'),
      provider: wssNet,
      toString: function() { return this.description; }
    }
  }
  if (host === 'wss'){
    return {
      type: 'wss',
      description: `wss://<internal>/${port}`,
      host: '<internal>',
      port: port,
      provider: wssNet,
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
