"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var WebSocketServer = require("websocket").server;

// Pathnames of the SSL key and certificate files to use for
// HTTPS connections.

const keyFilePath = "/etc/pki/tls/private/mdn-samples.mozilla.org.key";
const certFilePath = "/etc/pki/tls/certs/mdn-samples.mozilla.org.crt";

function log(text) {
  var time = new Date();
  console.log("[" + time.toLocaleTimeString() + "] " + text);
}

// If you want to implement support for blocking specific origins, this is
// where you do it. Just return false to refuse WebSocket connections given
// the specified origin.
function originIsAllowed(origin) {
  return true; // We will accept all connections
}

var httpsOptions = {
  key: null,
  cert: null,
};

try {
  httpsOptions.key = fs.readFileSync(keyFilePath);
  try {
    httpsOptions.cert = fs.readFileSync(certFilePath);
  } catch (err) {
    httpsOptions.key = null;
    httpsOptions.cert = null;
  }
} catch (err) {
  httpsOptions.key = null;
  httpsOptions.cert = null;
}

// If we were able to get the key and certificate files, try to
// start up an HTTPS server.

var webServer = null;

try {
  if (httpsOptions.key && httpsOptions.cert) {
    webServer = https.createServer(httpsOptions, handleWebRequest);
  }
} catch (err) {
  webServer = null;
}

if (!webServer) {
  try {
    webServer = http.createServer({}, handleWebRequest);
  } catch (err) {
    webServer = null;
    log(`Error attempting to create HTTP(s) server: ${err.toString()}`);
  }
}

// Our HTTPS server does nothing but service WebSocket
// connections, so every request just returns 404. Real Web
// requests are handled by the main server on the box. If you
// want to, you can return real HTML here and serve Web content.

function handleWebRequest(request, response) {
  log("Received request for " + request.url);
  response.writeHead(404);
  response.end();
}

// Spin up the HTTPS server on the port assigned to this sample.
// This will be turned into a WebSocket port very shortly.

webServer.listen(6503, function () {
  log("Server is listening on port 6503");
});

// Create the WebSocket server by converting the HTTPS server into one.

var wsServer = new WebSocketServer({
  httpServer: webServer,
  autoAcceptConnections: false,
});

if (!wsServer) {
  log("ERROR: Unable to create WbeSocket server!");
}

// Set up a "connect" message handler on our WebSocket server. This is
// called whenever a user connects to the server's port using the
// WebSocket protocol.
const users = new Set();
const connectionMapping = {};

wsServer.on("request", function (request) {
  if (!originIsAllowed(request.origin)) {
    request.reject();
    log("Connection from " + request.origin + " rejected.");
    return;
  }
  var connection = request.accept("json", request.origin);
  // Add the new connection to our list of connections.
  log("Connection accepted from " + connection.remoteAddress + ".");

  function sendActiveUsersList() {
    for (const user of users) {
      const conn = connectionMapping[user];
      conn.sendUTF(
        JSON.stringify({
          activeUsers: [...users],
          type: "ACTIVE_USERS",
        })
      );
    }
  }
  connection.on("message", function (message) {
    if (message.type === "utf8") {
      log("Received Message: " + message.utf8Data);
      var sendToClients = true;
      var msg = JSON.parse(message.utf8Data);
      switch (msg.type) {
        // Public, textual message
        case "USER-AVAILABILITY":
          users.add(msg.username);
          connection.username = msg.username;
          connectionMapping[msg.username] = connection;
          sendActiveUsersList();
          break;

        case "ACTIVE_USERS":
          connection.sendUTF(
            JSON.stringify({
              activeUsers: [...users],
              type: "ACTIVE_USERS",
            })
          );
          break;

        case "USER-UN-AVAILABILITY":
          log("User unavailable ", msg);
          users.delete(msg.username);
          // sendActiveUsersList()
          console.log(users);
          delete connectionMapping[msg.username];
          break;

        case "INITIATE_REMOTE_ICE_CANDIDATE":
          connectionMapping[msg.receiver].sendUTF(
            JSON.stringify({
              type: "MESSAGE_SET_REMOTE_ICE_CONNECTION",
              iceCandidate: msg.iceCandidate,
              sender: msg.sender,
              receiver: msg.receiver,
            })
          );
          break;

        case "INITIATE_SENDER_ICE_CANDIDATE":
          const sender = msg.sender;
          const receiver = msg.receiver;
          const receiverConn = connectionMapping[receiver];
          console.log("Send to ", receiver);
          receiverConn.sendUTF(
            JSON.stringify({
              type: "MESSAGE_CONNECTION_INITIATION",
              iceCandidate: msg.iceCandidate,
              sender,
              receiver,
            })
          );
          break;

        default:
          console.log("No Matching type ", msg);
      }
    }
  });

  // Handle the WebSocket "close" event; this means a user has logged off
  // or has been disconnected.
  connection.on("close", function (reason, description) {
    console.log("Closed Connection For ", connection.username);
    users.delete(connection.username);
    delete connectionMapping[connection.username];
    sendActiveUsersList();
  });
});
