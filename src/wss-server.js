const wssServer = async (config) => {
  const https = require('https')
  const selfSigned = require('selfsigned')
  const WebSocket = require('ws')
  
  const cert = selfSigned.generate({}, { days: 3650 })
  const server = await new Promise((resolve, reject) => {
    const server = https.createServer({
      key: cert.private,
      cert: cert.cert
    })
  
    server.once('error', reject)
    server.listen(config.listen.port, config.listen.host, () => resolve(server))
  })

  const wss = new WebSocket.Server({noServer: true}) 

  server.on('upgrade', (req, socket, head) => {
    console.log('wss server received:', req.url)
    // const transport = transports.getTransport(config.connect[0].host, config.connect[0].port);
  })

  console.log('wss server started')

}

module.exports = wssServer