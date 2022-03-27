import "./App.css";
import React from "react";

function makeid(length) {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function App({ username }) {
  return (
    <div className="App">
      welcome Random User <b>{username}</b>
      <header className="App-header"></header>
    </div>
  );
}

class WebsocketConnectivity {
  static connection;
  static connectionEstablished = 0;
  rpcConnections = {};
  dataChannels = {};

  subscribers = {
    ACTIVE_USERS: [],
    RECEIVED_MESSAGES: {},
  };

  subscribeMessages(type, callback) {
    if (!this.subscribers.RECEIVED_MESSAGES[type]) {
      this.subscribers.RECEIVED_MESSAGES[type] = [];
    }
    this.subscribers.RECEIVED_MESSAGES[type].push(callback);
  }

  subscribe(type, callback) {
    this.subscribers[type].push(callback);
  }

  connect() {
    const serverUrl = "ws://localhost:6503";
    if (!WebsocketConnectivity.connection) {
      WebsocketConnectivity.connection = new WebSocket(serverUrl, "json");

      WebsocketConnectivity.connection.onopen = function (evt) {
        console.log("Connection opened ", evt);
        WebsocketConnectivity.connectionEstablished = 1;
      };

      WebsocketConnectivity.connection.onerror = function (evt) {
        console.dir(evt);
        WebsocketConnectivity.connectionEstablished = 2;
      };
      let that = this;

      WebsocketConnectivity.connection.onmessage = function (evt) {
        const msg = JSON.parse(evt.data);
        const type = msg.type;
        switch (type) {
          case "ACTIVE_USERS":
            const type_subscribers = that.subscribers[type];
            if (type_subscribers) {
              for (let subs of type_subscribers) {
                subs(msg);
              }
            }
            break;

          case "MESSAGE_SET_REMOTE_ICE_CONNECTION":
            console.log(msg);
            const answer = msg.iceCandidate;
            const dataChannel = that.dataChannels[msg.sender];
            const rpcConnection = that.rpcConnections[msg.sender];
            console.log({ dataChannel }, { rpcConnection });
            if (rpcConnection.signalingState !== "stable") {
              rpcConnection.setRemoteDescription(answer);
              console.log("Set Remote Description");
            }
            break;

          case "MESSAGE_CONNECTION_INITIATION":
            const offer = JSON.parse(msg.iceCandidate);
            console.log(offer);
            const remoteConnection = new RTCPeerConnection();
            remoteConnection.onicecandidate = (e) => {
              // this ice candidate needs to be sent to sender
              console.log(
                " NEW ice candidate!! on localconnection reprinting SDP "
              );
              that.sendRemoteIceCandidate(
                remoteConnection.localDescription,
                msg.sender,
                msg.receiver
              );
              console.log(JSON.stringify(remoteConnection.localDescription));
            };

            remoteConnection.ondatachannel = (e) => {
              console.log(e);
              const receiveChannel = e.channel;
              receiveChannel.onmessage = (e) => {
                const data = JSON.parse(e.data);
                const receivedSubscribers =
                  that.subscribers["RECEIVED_MESSAGES"][data.from];
                if (receivedSubscribers && receivedSubscribers.length > 0) {
                  for (const subs of receivedSubscribers) {
                    subs(e);
                  }
                }
              };

              receiveChannel.onopen = (e) => console.log("open!!!!");
              receiveChannel.onclose = (e) => console.log("closed!!!!!!");
              remoteConnection.channel = receiveChannel;
            };

            remoteConnection
              .setRemoteDescription(offer)
              .then((a) => console.log("Offer Set!"));

            remoteConnection
              .createAnswer()
              .then((a) => remoteConnection.setLocalDescription(a))
              .then((a) =>
                console.log(JSON.stringify(remoteConnection.localDescription))
              );
            break;
        }
      };
    }
  }

  sendRemoteIceCandidate(icecandidate, receiver, sender) {
    const data = {
      type: "INITIATE_REMOTE_ICE_CANDIDATE",
      receiver,
      sender,
      iceCandidate: icecandidate,
    };
    this.send(JSON.stringify(data));
  }

  sendIceCandidate(icecandidate, receiver, sender) {
    const data = {
      type: "INITIATE_SENDER_ICE_CANDIDATE",
      receiver,
      sender,
      iceCandidate: icecandidate,
    };
    this.send(JSON.stringify(data));
  }

  send(data) {
    if (
      WebsocketConnectivity.connection &&
      WebsocketConnectivity.connection.readyState === 1
    ) {
      WebsocketConnectivity.connection.send(data);
    } else {
      const that = this;
      setTimeout(() => {
        that.send(data);
      }, 1000);
    }
  }

  async sendUserAvailableStatus(username) {
    const data = {
      username,
      type: "USER-AVAILABILITY",
    };
    this.send(JSON.stringify(data));
  }

  async sendUserUnAvailableStatus(username) {
    const data = {
      username,
      type: "USER-UN-AVAILABILITY",
    };
    this.send(JSON.stringify(data));
  }
}

const socket = new WebsocketConnectivity();

class Message extends React.Component {
  state = {
    message: "",
    connectionInitiated: false,
  };

  onMessageChange = ({ target: { value } }) => {
    this.setState({ message: value });
  };

  initiateConnection = () => {
    // check if rpcConnection is already established with the receiver;
    const { friendUsername, myUsername } = this.props;
    let localConnection = socket.rpcConnections[myUsername];

    if (!localConnection) {
      localConnection = new RTCPeerConnection();
      localConnection.onicecandidate = (e) => {
        console.log(" NEW ice candidate!! on localconnection reprinting SDP ");
        /*
        This ice candidate has to be sent to the other party , receiver
        */
        console.log(JSON.stringify(localConnection.localDescription));
        socket.sendIceCandidate(
          JSON.stringify(localConnection.localDescription),
          friendUsername,
          myUsername
        );
      };
      const sendChannel = localConnection.createDataChannel(friendUsername);
      sendChannel.onmessage = (e) =>
        console.log("messsage received!!!" + e.data);
      sendChannel.onopen = (e) => console.log("open!!!!");
      sendChannel.onclose = (e) => console.log("closed!!!!!!");
      localConnection
        .createOffer()
        .then((o) => localConnection.setLocalDescription(o))
        .then((a) => console.log("Set Successfully!"));
      socket.rpcConnections[friendUsername] = localConnection;
      socket.dataChannels[friendUsername] = sendChannel;
      this.setState({ connectionInitiated: !this.state.connectionInitiated });
    }
  };

  sendMessage = () => {
    const { message } = this.state;
    const { friendUsername, myUsername } = this.props;
    const channel = socket.dataChannels[friendUsername];
    channel.send(
      JSON.stringify({
        message,
        from: myUsername,
        to: friendUsername,
      })
    );
  };

  render() {
    const { friendUsername, history,messagesReceived,myUsername } = this.props;
    const { connectionInitiated } = this.state;
    console.log(messagesReceived);
    console.log("FriendUsernmae " ,friendUsername , "MY username " , myUsername);
    return (
      <div style={{ top: "20%", left: "30%", transform: "translate(20%,20%)" }}>
        <div>
          <strong> Send Message To {friendUsername} </strong>
        </div>
        <textarea
          disabled
          style={{ height: 350, width: 450, overflow: "scroll" }}
          value={history}
        />
        <br />
        <input
          style={{ width: 450 }}
          onChange={this.onMessageChange}
          value={this.state.message}
        />
        {!connectionInitiated && (
          <button onClick={this.initiateConnection}>InitiateConnection</button>
        )}
        {connectionInitiated && (
          <button onClick={this.sendMessage}>Send</button>
        )}
      </div>
    );
  }
}

class User extends React.Component {
  state = {
    messagesReceived: {},
  };

  componentDidMount() {
    const { user } = this.props;
    if (user) {
      socket.subscribeMessages(user, (e) => {
        console.log("User Received data in subscriber from ", " message ", e);
        const data = JSON.parse(e.data);
        const {message ,from} = data;
        console.log(message , from)
        this.setState((prevState) => {
          if (prevState.messagesReceived[from]) {
            return {
              ...prevState,
              messagesReceived: {
                ...prevState.messagesReceived,
                [from]: [
                  ...prevState.messagesReceived[from],
                  `${message}\n`
                ],
              },
            };
          } else {
            return {
              ...prevState,
              messagesReceived: {
                ...prevState.messagesReceived,
                [from]: [`${message}\n`]
              },
            };
          }
        });
      });
    }
  }
  setCurrentUser = (value) => {
    // this.setState({ currentReceiverUser: value });
  };
  render() {
    const { user,key } = this.props;
    if (user === this.props.username) return <span />;
    return (
      <>
        <p
          key={key}
          style={{ margin: 2, padding: 2, color: "green" }}
          onClick={() => {
            this.setCurrentUser(user);
          }}
        >
          {user}
        </p>
        <Message
          friendUsername={user}
          myUsername={this.props.username}
          history={this.state.messagesReceived[user]}
          messagesReceived={this.state.messagesReceived}
        />
      </>
    );
  }
}
class ActiveUser extends React.Component {
  state = {
    activeUsers: [],
  };

  componentDidMount() {
    socket.subscribe("ACTIVE_USERS", (data) => {
      console.log("Subscribed data ", data);
      this.setState({ activeUsers: data.activeUsers });
    });
    const { username } = this.props;
    socket.sendUserAvailableStatus(username);
  }

  componentCleanup() {
    const { username } = this.props;
    console.log("User is un-available ", username);
    socket.sendUserUnAvailableStatus(username);
  }

  componentWillUnmount() {
    this.componentCleanup();
    window.removeEventListener("beforeunload", this.componentCleanup); // remove the event handler for normal unmounting
  }

  render() {
    const { activeUsers } = this.state;
    if (!activeUsers || activeUsers.length === 0)
      return <div> No Active Users</div>;

    const UserDisplay = activeUsers.map((user, index) => (
      <User
        user={user}
        username={this.props.username}
        key={index}
        setCurrentUser={this.props.setCurrentUser}
      />
    ));

    return <span>{UserDisplay}</span>;
  }
}

class ChatApp extends React.Component {
  state = {
    username: "",
  };

  componentDidMount() {
    socket.connect();
    const username = makeid(6);
    this.setState({ username });
  }

  randomCall() {
    const videoEle = document.querySelector("local-video");
  }

  render() {
    const { username } = this.state;
    return (
      <div>
        <App username={username} />
        <hr />
        {username.length === 6 && (
          <ActiveUser
            username={username}
            setCurrentUser={this.setCurrentUser}
          />
        )}
        {/* )} */}
        {/* <div style={{display:"flex",marginLeft:"350px"}}>
          <VideoPlayer id="local-video"/>
          <VideoPlayer id="receiver-video"/>
        </div>
        <button onClick={this.randomCall}> Random call</button> */}
      </div>
    );
  }
}

class VideoPlayer extends React.Component {
  render() {
    return (
      <div
        style={{
          margin: 15,
          padding: 15,
          height: "400px",
          width: "350px",
          background: "green",
        }}
      >
        <video id={this.props.id} />
      </div>
    );
  }
}

export default ChatApp;
