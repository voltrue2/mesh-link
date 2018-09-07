# mesh-link

©Nobuyori Takahashi < <voltrue2@yahoo.com> >

Mesh Link is a server-side mesh network module that allows your processes to talk to each other remotely (within your private network **ONLY**).

The module uses **redis**, but it does not depend on it to handle the communications between server processes.

- Each mesh node semi-automatically discovers other mesh nodes via redis.

- All mesh nodes automatically detects when a new mesh node joins and when a mesh node leaves.

- It uses RUDP (Reliable User Datagram Protocol) for communication between the mesh nodes.

- The module allows to send a request message to another mesh node and require the receiver to send a response.

# What Can I Use this Module For?

- You may use the module to connect micro-service servers. (Faster and lighter than HTTP).

- The module is also ideal for clustered real-time game servers.

Of course these aren't the only ways to use this module.

# How To Install

```
npm install mesh-link
```

# How To Use

## Set Up Your Mesh Node

This is how you set up your mesh node and start it.

```javascript
const mlink = require('mesh-link');
var configs = {
    redis: {
        host: '127.0.0.1',
        port: 6379
    },
    relayLimit: 10,
    prefix: 'myapp'
};
mlink.start(configs)
    .then(() => {
        // Your mesh node is ready!
    })
    .catch((error) => {
        // error...
    });
```

## Configurations

|Name      |Required|Default                                |Explanation                                                                              |
|:---------|:------:|--------------------------------------:|:----------------------------------------------------------------------------------------|
|redis.host|YES     |`'127.0.0.1'`                          |Host name of Redis                                                                       |
|redis.port|YES     |`6379`                                 |Port of Redis                                                                            |
|relayLimit|NO      |`10`                                   |When sending a message to multiple mesh node, it sends the message `relayLimit` at a time|
|prefix    |NO      |`''`                                   |A custom prefix for the keys stored in Redis                                             |
|address   |NO      |Dynamically obtained private IP address|IP address to bind                                                                       |
|port      |NO      |`8100`                                 |Port range to bind. If it is 8100, then it will bind and increment                       |

## How To Send A Mesh Network Message

```javascript
const mlink = require('mesh-link');
var handlerId = 1000;
var data = { message: 'Hello World!' };
// mesh nodes to send the message to
var nodes = [
    { address: '0.0.0.0', port: 8100 },
    { address: '0.0.0.0', port: 8101 }    
];
mlink.send(handlerId, nodes, data);
```

## How To Set Up A Message Handler

When you send a mesh network message to another mesh node,

You must have a handler for that message in order to do **something**.

Consider `handlerId` as a URI of a HTTP request.

**mesh-link** manages this by allowing you to define a handling function and its unique ID (UInt16).

```javascript
const mlink = require('mesh-link');
var handlerId = 1000;
mlink.handler(handlerId, message1000Handler);

function message1000Handler(data) {
    var message = data.message;
    console.log('Another mesh node says:', message);
}
```

## How To Send a Mesh Network Message And Ask For A Response Back

In order for this to worker, the handler function **MUST** send the response back with the data you require.

```javascript
const mlink = require('mesh-link');
var handlerId = 2000;
var data = { message: 'foobar' };
var nodes = [
    { address: '0.0.0.0', port: 8100 }
];
mlink.send(handlerId, nodes, data, (responseData) => {
    console.log(responseData.message, 'response took', Date.now() - responseData.time, 'milliseconds');
});
```

## How To Set Up A Message Handler With Response

```javascript
const mlink = require('mesh-link');
var handlerId = 2000;
mlink.handler(handlerId, message2000Handler);

function message200Handler(data, callback) {
    var responseData = { message: data.message + '!!!', time: Date.now() };
    // make sure to call this callback to send the response
    callback(responseData);
}
```

# Methods

**mesh-link** has plethora of functions to help you build your application using mesh network!

## start(configs, callback)

Starts mesh network. The function also returns a `Promise` object.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|configs |NO      |Object   |Configurations|
|callback|NO      |Function |Callback function, if you are not using Promise, this is required|

## stop(callback)

Stops mesh network. The function also returns a `Promise` object.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|callback|NO      |Function |Callback function, if you are not using Promise, this is required|

## info()

Returns the IP address and port number that this mesh network node uses as an object.

```
{ address: '0.0.0.0', port: 8101 }
```

## handler(handlerId, handlerFunction)

Defines a handler function for the give handler ID.

All messages with the same handler ID will trigger this handler function.

|Argument       |Required|Data Type|Explanation   |
|:--------------|:------:|:--------|:-------------|
|handlerId      |YES     |Number   |Unique ID of a handler (Max 0xffff)|
|handlerFunction|YES     |Function |A function to be executed on the given handler ID|

## send(handlerId, nodes, data, callback)

Sends a mesh network message with a handler ID to one or more mesh network nodes.

If `callback` is given, it is understood to require a response back.

**NOTE** If you require a response callback and send a message to multiple mesh nodes, the response callback will be sent from only **ONE** of the mesh nodes.

|Argument       |Required|Data Type|Explanation   |
|:--------------|:------:|:--------|:-------------|
|handlerId      |YES     |Number   |Unique ID of a handler (Max 0xffff)|
|nodes          |YES     |Array    |An array of mesh nodes' address and port to send the message to|
|data           |YES     |Object   |Message as an object to be sent|
|callback       |NO      |Function |Provid the callback function if you require a response back|

## usend(handlerId, nodes, data, callback)

Sends an unreliable mesh network message with a handler ID to one or more mesh network nodes.

This is a plain UDP message and the message may be lost due to the nature of UDP protocol.

The advantage of using this method is message size is much smaller than that of `send()` and less UDP packets required.

**NOTE** Callback response message may also be lost.

|Argument       |Required|Data Type|Explanation   |
|:--------------|:------:|:--------|:-------------|
|handlerId      |YES     |Number   |Unique ID of a handler (Max 0xffff)|
|nodes          |YES     |Array    |An array of mesh nodes' address and port to send the message to|
|data           |YES     |Object   |Message as an object to be sent|
|callback       |NO      |Function |Provid the callback function if you require a response back|

## onUpdate(handler)

`handler` is called before the mesh network node updates its sate to Redis.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|handler |YES     |Function |A handler function to be called every time before update of its state|

## onUpdated(handler)

`handler` is called after the mesh network node updates its state to Redis and other mesh nodes' states.

A copy of other nodes' states including its own state, is passed to `handler` as an argument.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|handler |YES     |Function |A handler function to be called every time before update of its state|

## setValue(name, value)

It can set any value to be shared with other mesh network nodes.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|name    |YES     |String   |A name of the value|
|value   |YES     |Any      |A value to be shared with other mesh nodes|

Example:

```javascript
const mlink = require('mesh-link');
mlink.setValue('serverType', 'TCP');
mlink.setValue('serverStatus', 'online');
```

## getNodeValue(address, port, name)

Returns all values set by `setValue(...)` as an object.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|address |YES     |String   |IP address of the target mesh node|
|port    |YES     |Number   |Port of the target mesh node|

## getNodeEndPoints()

Returns all mesh nodes' address and port as an array.

```
[
    { address: '0.0.0.0', port: 8100 },
    { address: '0.0.0.0', port: 8101 },
    {...}
]
```

## nodeExists(address, port)

Returns a boolean to indicate if asked mesh node exists or not

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|address |YES     |String   |IP address of the target mesh node|
|port    |YES     |Number   |Port of the target mesh node|

## isLocalNode(address, port)

Returns a boolean to indicate if asked node is itself or not.

|Argument|Required|Data Type|Explanation   |
|:-------|:------:|:--------|:-------------|
|address |YES     |String   |IP address of the target mesh node|
|port    |YES     |Number   |Port of the target mesh node|

# How To Test For Communications

You may want to test if all nodes can communicate each other before launching your application.

To do that, you simply need to execute `./bin/ping <address of a mesh node> <port of a mesh node>`.

If you get `PONG\n` back from the targeted mesh node, it means you can talk to that mesh node.

