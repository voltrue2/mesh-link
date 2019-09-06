# mesh-link

©Nobuyori Takahashi < <voltrue2@yahoo.com> >

[![Build Status](https://travis-ci.org/voltrue2/mesh-link.svg?branch=develop)](https://travis-ci.org/voltrue2/mesh-link)

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
    updateInterval: 1000,
    relayLimit: 1,
    relayDelay: 0,
    prefix: 'myapp',
    strict: false
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

|Name          |Required|Default                                |Explanation                                                                              |
|:-------------|:------:|--------------------------------------:|:----------------------------------------------------------------------------------------|
|redis.host    |YES     |`'127.0.0.1'`                          |Host name of Redis                                                                       |
|redis.port    |YES     |`6379`                                 |Port of Redis                                                                            |
|updateInterval|NO      |`1000`                                 |Update to Redis interval in milliseconds                                                 |
|relayLimit    |NO      |`1`                                    |When sending a message to multiple mesh node, it sends the message `relayLimit` at a time|
|relayDelay    |NO      |`0`                                    |Delays relay message by X milliseconds                                                   |
|prefix        |NO      |`''`                                   |A custom prefix for the keys stored in Redis                                             |
|nic           |NO      |`'eth0'`                               |Specify which network interface to use to dynamically obtain the IP address to bind to   |
|address       |NO      |Dynamically obtained private IP address|IP address to bind. It uses `eth0` by default. To change this, you must set `nic` to something else|
|port          |NO      |`8100`                                 |Port range to bind. If it is 8100, then it will bind and increment                       |
|backups       |NO      |                                       |A map by node types to indicate each node type's number of other mesh nodes to be used as potential backup (you need to write your own backup logic)|
|sendInterval  |NO      |0                                      |If greater than 0, all messages will be "batched" at given interval in milliseconds to be sent|
|strict        |NO      |true                                   |If `true` and `nic` is given, but not found, mesh-link will throw an exception at start  |

### Master-Slave Redis Configurations

If you are connecting to master-slave setup, you need to use the following configurations instead of `redis { host, port }` property:

**NOTE** If you want to have multiple slave Redis servers, you need to have a load balancer over the slave redis servers.

|redis.multi.master.host|
|redis.multi.master.port|
|redis.multi.slave.host |
|redis.multi.slave.port |

## Use Redis Sentinel

mesh-link supports Redis Sentinel also. In order to connect to Redis Sentinel, your configurations follow as shown below:

```
{
    redis: {
        sentinel: [
            { host, port },
            { host, port}
            [...]
        ]
    }
}
``

The `cluster` property must be an array with host and port objects. You do not have to cover all of your cluster nodes, but just a few.

## Use Redis Sentiel

mesh-link supports Redis Cluster also. In order to connect to Redis Cluster, your configurations follow as shown below:

```
{
    redis: {
        sentinel: [
            { host, port },
            { host, port}
            [...]
        ]
    }
}
``

The `sentinel` property must be an array with host and port objects. You do not have to cover all of your sentinel nodes, but just a few.

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
mlink.send(handlerId, nodes, data, (error, responseData) => {
    if (error) {
        console.log('error occur: ' + error.message);
        return;
    }
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

## How To Get A Sender Information

```javascript
const mlink = require('mesh-link');
var handlerId = 3000;
mlink.handler(handlerId, message3000Handler);

function message3000Handler() {
    // You can get sender information using this.sender
    console.log('Message from: ' + this.sender.address + ':' + this.sender.port);
}
```

# Shared Objects

A shared object is an object that can be shared and mutated from all mesh nodes asynchronously, and the object remains synchronized across all mesh nodes.

More details on Shared Object is [HERE](#so)

Example:

Mesh Node 1: Create a new shared object and store it on mesh node 2

```javascript
const mlink = require('mesh-link');
var objectProperties = {
    counter: { value: 0, min: 0, max: 100 },
    name: { value: 'Foobar' },
    members: { value: {} }
};
// this shared object will disapeare if there is no change in 60 seconds
var ttl = 60000;
var nodeToStore = { address: '...', port: 8100 };
// this will create the shared object locally and sync it to the targeted node
var so = mlink.sharedObject.create(objectProperties, ttl, nodeToStore);
// add an event listener to be triggered when something happens to this shared object
so.on('update', (me, propertyName, propertyValue) => {
    // do something...
});
// make sure you have a cleaning function on remove event
so.on('remove', () => {
    // clean this object reference to avoid memory leak
    so = null;
});
// this change is automatically synced to all mesh nodes that has this shared object
// increment count by 10
so.inc('counter', 10);
// add a new item to the map
so.add('members', 'memberId-1', {name:'Bob'});
// mid is used to identify each shared object
var sendMidToNode2 = so.mid;
```

Mesh Node 2: Obtain the shared object that created on mesh node 1

```javascript
const mlink = require('mesh-link');
// you must share mid of the shared object you want to get access to
mlink.sharedObject.get(mid)
    .then((so) => {
        // now he have the same shared object here on mesh node 2
        // make sure you have a cleaning function on remove event
        so.on('remove', () => {
            // clean this object reference to avoid memory leak
            so = null;
        });
        // this is automatically synced to both mesh node 1 and the node and other nodes that have this shared object!
        so.inc('counter', -3);
        so.del('members', 'memberId-1');
    })
    .catch((error) => {
        // error...
    });
```

Mesh Node 3: Remove a shared object across all mesh nodes

**IMPORTANT** You must have an event listner for `remove` event in order to perform cleaning to avoid memory leak by leaving the references behind

```javascript
const mlink = require('mesh-link');
// make sure this reference has the listener to destory the reference on remove
so.on('remove', () => {
    // destory the object reference
    so = null;
});
// pass the shared object to remove
// this will automatically propagate to all mesh nodes
mlink.shared.Object.remove(so);
```

# Methods

**mesh-link** has plethora of functions to help you build your application using mesh network!

## setType(nodeType)

It sets the mesh node type of your choice.

It **MUST** be called before `.start()`

```javascript
mlink.setType('MyCustomNodeType');
mlink.start();
```

## getType()

Returns the value of mesh node type set by `.setType()`.

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

## setSplitSize(splitSize)

You may change the maximum byte size threshold for each mesh network message to be split into multiple messages.

## info()

Returns the IP address and port number that this mesh network node uses as an object.

```
{ address: '0.0.0.0', port: 8101 }
```

## handler(handlerId, handlerFunction)

Defines a handler function for the give handler ID.

All messages with the same handler ID will trigger this handler function.

**IMPORTANT** The range of valid handler ID is from 0 to 65000.

|Argument       |Required|Data Type|Explanation   |
|:--------------|:------:|:--------|:-------------|
|handlerId      |YES     |Number   |Unique ID of a handler (Max 0xffff)|
|handlerFunction|YES     |Function |A function to be executed on the given handler ID|

## prepareNodes(nodeType, nodes)

Returns only valid mesh nodes to be used by `.send()` and `.usend()`.

It requires `nodes` to have the same `type` as `nodeType` given in the first argument.

The main purpose of this method is to automatically replace invalid or dead mesh nodes with their backup nodes.

```javascript
var preparedNodes = mlink.prepareNodes('MyCustomNodeType', nodes);
mlink.send(handlerId, preparedNodes, data);
```

## send(handlerId, nodes, data, callback, options)

Sends a mesh network message with a handler ID to one or more mesh network nodes.

If `callback` is given, it is understood to require a response back.

**NOTE** If you require a response callback and send a message to multiple mesh nodes, the response callback will be sent from only **ONE** of the mesh nodes.

|Argument       |Required|Data Type|Explanation   |
|:--------------|:------:|:--------|:-------------|
|handlerId      |YES     |Number   |Unique ID of a handler (Max 0xffff)|
|nodes          |YES     |Array    |An array of mesh nodes' address and port to send the message to|
|data           |YES     |Object   |Message as an object to be sent|
|callback       |NO      |Function |Provid the callback function if you require a response back|
|options.limit  |NO      |Number   |Overwrites configuration relayLimit|

## usend(handlerId, nodes, data, callback, options)

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
|options.limit  |NO      |Number   |Overwrites configuration relayLimit|

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

**IMPORTANT** The value must **NOT** contain `"`"`.

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

## getNodesByType(nodeType)

Returns all mesh nodes of the type given as `nodeType`.

```
[
    { address: '0.0.0.0', port: 8100 },
    { address: '0.0.0.0', port: 8101 },
    {...}
]
```

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

Returns a boolean to indicate if asked mesh node exists or not.

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

## getBackupNodes(address, port)

Returns back up mesh nodes as an array of the given mesh node address and port.

If no address and port are given, it returns the back up mesh nodes array of its own.

<a name="so"></a>
## sharedObject.create(properties, ttl, node)

Creates a shared object with the given properties.

It returns an instance of the shared object created.

|Argument  |Required|Data Type|Explanation                    |
|:---------|:------:|:--------|:------------------------------|
|properties|YES     |Object   |Properties of the shared object|
|ttl       |NO      |Number   |Optional TTL of the shared object in milliseconds. Default is 300000ms (5 minutes)|
|node      |YES     |Object   |The mesh node address and port to store the shared object: { address, port }|

**Properties Format**

The properties of a shared object is defined as:

```
{
    <property name>: {
        value: <initial value>,
        min: <if the value is a number>,
        max: <if the value is a number>
    }
    {...}
}
```

## sharedObject.remove(sharedObject)

Deletes the given shared object across all mesh nodes.

|Argument    |Required|Data Type|Explanation                                |
|:-----------|:------:|:--------|:------------------------------------------|
|sharedObject|YES     |Object   |The instance of shared object to be deleted|

## sharedObject.get(mid, callback)

Retrieves a shared object specified by `mid` (managed ID) from the mesh node that it lives and caches it locally.

It returns Promise.

|Argument  |Required|Data Type|Explanation                                        |
|:---------|:------:|:--------|:--------------------------------------------------|
|mid       |YES     |String   |Managed ID of the shared object: `sharedObject.mid`|
|callback  |NO      |Function |Returns with an error or a shared object. If you use Promise, you do not need the callback|

## Instance of Shared Object

An instance of shared object has methods and properties.

Currently the properties support the following data types: `Number` and `Map`.

## .mid

This is the unique ID of this particular shared object.

## .get(propertyName)

Returns the value of a property specified by `propertyName`.

## Promise .inc(propertyName, value, callback)

If the targeted property is a number, it performs increment by the given `value`.

If you want to make sure, the change has been successful, you can either pass a callback or use a promise.

Below is the example using Promise:

```javascipt
// this is a shared object
bunny.inc('stamina', 3)
    .then(() => {
        // increment was successul
    })
    .catch((error) => {
        // increment rejected
    });
```

## Promise .set(propertyName, value, callback)

It replaces the value of the targeted property.

If you want to make sure, the change has been successful, you can either pass a callback or use a promise.

Below is the example using Promise:

```javascipt
// this is a shared object
bunny.set('name', 'Peter')
    .then(() => {
        // set was successul
    })
    .catch((error) => {
        // set rejected
    });
```

## Promise .add(propertyName, key, value, callback)

If the targeted property is a map, it adds a new key with a value to the map property.

If you want to make sure, the change has been successful, you can either pass a callback or use a promise.

Below is the example using Promise:

```javascipt
// this is a shared object
swimmingClub.add('members', 'memberId-100', { name: 'Bod', age: 40 })
    .then(() => {
        // add was successul
    })
    .catch((error) => {
        // add rejected
    });
```

## del(propertyName, key, callback)

If the targeted property is a map, it remves the key and its value from the map property.

If you want to make sure, the change has been successful, you can either pass a callback or use a promise.

Below is the example using Promise:

```javascipt
// this is a shared object
swimmingClub.del('members', 'memberId-100')
    .then(() => {
        // delete was successul
    })
    .catch((error) => {
        // delete rejected
    });
```

## Evevnts

An instance of shared object also has some events you can listen to.

## update

Update event is triggered whenever the shared object's property is changed.

## remove

Remove event is triggered whenever the shared object is deleted from its source and internal cache.

Make sure to clean up all references that you might have when you get this event to avid memory leaks.

# How To Test For Communications

You may want to test if all nodes can communicate each other before launching your application.

To do that, you simply need to execute `./bin/ping <address of a mesh node> <port of a mesh node>`.

If you get `PONG\n` back from the targeted mesh node, it means you can talk to that mesh node.

