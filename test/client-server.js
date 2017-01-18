const main = require('../src/main');
const expect = require('chai').expect;
const vn = require('../src/virtual-net');
const tunnelClient = require('../src/tunnel-client');
const tunnelServer = require('../src/tunnel-server');
const debug = require('../src/debug');

debug.provider = null; // Disable logging

describe('persist-proxy', () => {
  var output;
  var sessions;
  var server;
  beforeEach(function() {
    output = [];
    sessions = [];
    vn._traceSessions = sessions;
    var count = 0;
    server = vn.createServer((s) => {
      const i = count++;
      output.push(`${i} connected`);
      s.on('data', (data) => {
        output.push(`${i} ${data}`);
        s.write(data.toString().toUpperCase());
      });
      s.on('error', (err) => {
        output.push(`${i} error`);
      })
      s.on('end', () => {
        output.push(`${i} end`);
      })
    });
    server.listen(1, 'proc');
  });

  afterEach(function() {
    server.close();
    vn._servers = {}; // Close all listeners
  })

  function client(host, port) {
    var output = [];
    const socket = vn.connect({host, port}, () => {
      output.push('connected')
    });
    socket.on('data', (data) => output.push(data));
    socket.on('error', (err) => output.push(err));
    socket.on('end', () => output.push('end'));
    return {
      output: output,
      write: (text) => socket.write(text),
      end: () => socket.end()
    }
  }

  const steps = (fns) => {
    if (fns.length) {
      const waitFor = fns[0]() || 10;
      setTimeout(() => steps(fns.slice(1)), waitFor);
    }
  }

  describe('test tools', () => {
    it('will be tested with a simple uppercase echo server.', (done) => {
      const c = client('proc', 1);
      steps([
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    });
    it('should accept named ports for proc.', (done) => {
      var c;
      steps([
        () => main("--forward proc:named:proc:1"),
        () => c = client('proc', 'named'),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    });

  })

  describe('tunnel', () => {

    it('should forward from the client to the server.', (done) => {
      var c;
      steps([
        () => main('--client proc:2:proc:3 --server proc:3:proc:1'.split(' ')),
        () => c = client('proc', 2),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])

    })
    it('should attempt to reconnect the client to the server after a timeout.', function(done) {
      this.timeout(20000);
      var c, session;
      steps([
        () => main('--client proc:2:proc:3 --server proc:3:proc:1'.split(' ')),
        () => c = client('proc', 2),
        () => 1000,
        () => {
          sessions[1].pause()
        },
        () => c.write('hello'),
        () => 8000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })

    it('should attempt to connect to any available server.', function(done) {
      this.timeout(20000);
      var c, session;
      steps([
        () => main('--client proc:2:proc:A:proc:B:proc:C:proc:3 --server proc:3:proc:1'.split(' ')),
        () => c = client('proc', 2),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })

    it('should disconnect from extra servers.', function(done) {
      this.timeout(20000);
      var c, session;
      steps([
        () => main('--client proc:2:proc:3:proc:4:proc:5:proc:6 --server proc:3:proc:1 --server proc:4:proc:1 --server proc:5:proc:1 --server proc:6:proc:1'.split(' ')),
        () => c = client('proc', 2),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })

    it('should end the client connection if the server restarts.', function(done) {
      this.timeout(10000);
      var c;
      steps([
        () => main('--server proc:server:proc:1'),
        () => main('--client proc:client:proc:server'),
        () => c = client('proc', 'client'),
        () => c.write('Hello'),
        () => 1000,
        () => {
          vn._servers['proc:server'].close();
          tunnelServer._system.sessions = {};
        },
        () => main('--server proc:server:proc:1'),
        () => sessions[1].pause(),
        () => 7000,
        () => expect(c.output.join(';')).to.equal('connected;HELLO;end'),
        () => done()

      ])
    })
  });

  describe('reverse', () => {
    it('should forward connections backwards', (done) => {
      var c;
      steps([
        () => main("--reverse-server proc:11"),
        () => main("--reverse-client proc:1:proc:11:proc:12"),
        () => c = client("proc", 12),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })

    it('should replace old reverse-servers with new ones', (done) => {
      var c;
      steps([
        () => main("--reverse-server proc:11"),
        () => main("--reverse-client proc:1:proc:11:proc:12"),
        () => main("--reverse-client proc:1:proc:11:proc:12"),
        () => c = client("proc", 12),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })
  })
  describe("persist-proxy cli", function() {
    it('should be chainable', function (done) {
      this.timeout(10000);
      var c;
      steps([
        () => main("--reverse-server proc:reverse-server"),
        () => main("--server proc:server:proc:reverse-server"),
        () => main("--client proc:client:proc:server"),
        () => main("--reverse-client proc:1:proc:reverse-server:proc:reverse-tunnel"),
        () => 100,
        () => main("--forward proc:fwd:proc:reverse-tunnel"),
        () => c = client("proc", "fwd"),
        () => c.write('hello'),
        () => 1000,
        () => c.end(),
        () => {
          expect(c.output.join(';')).to.equal('connected;HELLO');
          expect(output.join(';')).to.equal('0 connected;0 hello;0 end');
          done();
        }
      ])
    })



  })
})
