# persist-proxy

Persist-proxy is a two-part part port-forwarder that will maintain a connection during a network change or outage.

## Installing

```
npm install -g persist-proxy
```

## Usage

### On client machine

```
persist-proxy --client 127.0.0.1:30001:123.45.6.78:30002
```

### On server machine

```
persist-proxy --server 123.45.6.78:30002:127.0.0.1:30001
```

## Why persist-proxy?

I built this program because I personally run Windows 10 as my main OS, and Ubuntu on a second machine. I use
[VcXsrv](https://sourceforge.net/projects/vcxsrv/) on Windows as a display for my X applications. When I undock
my laptop, my connection shifts from ethernet to Wifi, I lose my X connections, and all my Ubuntu applications
close. With persist-proxy, instead of connecting directly to the VcXsrv, the apps connect to the proxy instead.
When my connection is lost, the applications momentarily freeze until the connection is reestablished. They
pick up where they left off.

## How does it work?

By default, applications on a client machine will connect directly to the server on another machine.

![Happy Connection](http://i.imgur.com/xciIo5q.png)

But when your network changes, or goes down, the applications freak out because they lost their connection.

![Unhappy Connection](http://i.imgur.com/V2wUvCI.png)

With persist-proxy, the application connects through the proxy, and the proxy connects to the server.

![Happy Proxy](http://i.imgur.com/hKVsK4j.png)

When a network break occurs, the applications don't know about it. Persist-proxy will cache all data being sent.

![Unhappy Proxy](http://i.imgur.com/gG7Qshi.png)

Persist-proxy will attempt to reconnect. When it succeeds, all data is flushed, and the applications just think it was lag.

![Recovered Proxy](http://i.imgur.com/gNoS2uh.png)
