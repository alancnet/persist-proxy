- **Handle server restarts**:
  - If a tunnelClient connects to a tunnelServer with
    an non-existent resume point, meaning the tunnelServer restarted,
    tell the tunnelClient END.
  - Add a --timeout feature for tunnelServer that disconnects the userServer
    once disconnected from the tunnelClient for too long.
  - Add a --timeout feature for tunnelClient that disconnects the userClient
    once disconnected from the tunnelServer for too long.
  - Maybe.. maybe maybe.. add a persistent unique identifier to the tunnelClient
    so that when new connections are detected on the tunnelServer, it can infer
    that disconnected sessions by the same client aren't coming back.

- **Handle mobility**:
  - Allow multiple connect-host and connect-port to be specified so the
    tunnelClient can round-robin between them until it finds a connection.
  - Allow connections to multiple tunnelSever hosts and pick the one with the
    lowest latency.
