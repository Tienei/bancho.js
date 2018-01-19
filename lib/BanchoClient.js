const net = require("net");
const EventEmitter = require("events").EventEmitter;

const BanchoUser = require("./BanchoUser");
const BanchoChannel = require("./BanchoChannel");
const BanchoRateLimiter = require("./BanchoRateLimiter");
const BanchoMultiplayerChannel = require("./BanchoMultiplayerChannel");
const ConnectStates = require("./ConnectStates");
const IrcCommands = require("./IrcCommands");
const Nodesu = require("nodesu");

const ignoredSplits = [
	"312",  // Whois server info (useless on Bancho)
	"333",  // Time when topic was set
	"366",  // End of NAMES reply
	"372",  // MOTD
	"375",  // MOTD Begin
	"376",  // MOTD End
	"QUIT", // User disconnects
];

/**
 * Client to connect to Bancho over its IRC gateway
 * @property {nodesu.Client} osuApi Populated with a Nodesu client, if api key is passed to the constructor
 * @extends {EventEmitter}
 */
class BanchoClient extends EventEmitter {
	/**
	 * @constructor
	 * @param {string} username Username of the user to connect to Bancho
	 * @param {string} password IRC Password of the user to connect to Bancho (see https://osu.ppy.sh/p/irc)
	 * @param {string} [host="irc.ppy.sh"] Custom IRC host (for proxy-ing from a firewall for example)
	 * @param {number} [port=6667] Custom IRC port
	 * @param {string} [apiKey] osu! API key for API requests (see https://osu.ppy.sh/p/api)
	 */
	constructor(username, password, host = "irc.ppy.sh", port = 6667, apiKey) {
		super();
		this.setMaxListeners(50);
		if(!username || !password)
			throw new Error("You gotta gimme an username and a password to connect to Bancho dumbass");
		this.username = username;
		this.password = password;
		this.host = host;
		this.port = port;
		
		this.client = null;
		this.connectState = ConnectStates.Disconnected;
		this.reconnect = true;
		this.reconnectTimeout = null;
		this.connectCallback = null;
		this.joinCallbacks = [];
		this.partCallbacks = [];
		if(apiKey)
			this.osuApi = new Nodesu.Client(apiKey, {
				parseData: true
			});
		this.users = {};
		this.usersById = {};
		this.channels = {};
		this.rateLimiter = new BanchoRateLimiter(60000, (300-30), (60-6)); // 10% margins to protect from accuracy issues (because of bancho/network...)

		// Register our own error listener so there are no uncaught exceptions
		// for exceptions WE throw for the end-user that don't need to be caught (such as timeouts)
		this.on("error", function() { });

		this.ignoreClose = false; // TODO: find something better than this solution. it works and is 100% reliable though! also eventually try with process.nextTick instead of setTimeout()
	}

	/**
	 * Before connecting, (re)defines the socket and all callbacks, because the client might get destroyed.
	 * @fires BanchoClient#error
	 * @private
	 */
	initSocket() {
		this.client = (new net.Socket()).setTimeout(60000);

		this.client.on("error", (err) => {
			/**
			 * An error has occured on the socket.
			 * @event BanchoClient#error
			 * @type {Error}
			 */
			this.emit("error", err);
			this.onClose(err);
		});
	
		this.client.on("close", () => {
			if(!this.ignoreClose)
				this.onClose(new Error("Connection closed"));
		});
		this.client.on("timeout", () => {
			const err = new Error("Timeout reached");
			this.ignoreClose = true;
			this.client.destroy();
			this.emit("error", err);
			this.onClose(err);
			setTimeout(() => this.ignoreClose = false, 1); // close event is apparently not fired immediately after calling destroy...
		});

		let unparsedData = "";
		this.client.on("data", (data) => {
			data = data.toString().replace(/\r/g, ""); // Sometimes, Bancho sends \r, and sometimes it doesn't.
			unparsedData += data;
			var index;
			while((index = unparsedData.indexOf("\n")) != -1) {
				var command = unparsedData.substring(0, index);
				unparsedData = unparsedData.substring(index + 1); // 1 is the length of \n, it being 1 special character and not 2.
				this.handleIrcCommand(command);
			}
		});
	}

	/**
	 * Send raw data over IRC.
	 * @param {string} data 
	 * @param {boolean} throwIfDisconnected Throws an Error if we're disconnected
	 * @private
	 */
	send(data, throwIfDisconnected = true) {
		if(this.connectState == ConnectStates.Connected || this.connectState == ConnectStates.Connecting)
			this.client.write(data + "\r\n");
		else if(throwIfDisconnected)
			throw new Error("Currently disconnected!");
	}

	/**
	 * Update connection state
	 * @param {ConnectState} newConnectState 
	 * @param {Error} err Error to emit with the new state
	 * @fires BanchoClient#connected
	 * @fires BanchoClient#disconnected
	 * @fires BanchoClient#state
	 * @private
	 */
	updateState(newConnectState, err) {
		if(newConnectState == this.connectState)
			return;
		if(newConnectState != ConnectStates.Disconnected &&
			newConnectState != ConnectStates.Reconnecting &&
			newConnectState != ConnectStates.Connecting &&
			newConnectState != ConnectStates.Connected)
			throw new Error("Invalid connect state!");
		this.connectState = newConnectState;
		if(this.isConnected())
			/**
			 * Connected to Bancho!
			 * @event BanchoClient#connected
			 */
			this.emit("connected");
		if(this.isDisconnected())
			/**
			 * Disconnected from Bancho!
			 * @event BanchoClient#disconnected
			 * @type {Error}
			 */
			this.emit("disconnected", err);
		/**
		 * ConnectState has updated! Emits with an error if any.
		 * @event BanchoClient#state
		 * @type {Error}
		 */
		this.emit("state", this.connectState, err);
	}

	/**
	 * Executed when connection is expectedly or not closed
	 * @param {Error} err 
	 * @private
	 */
	onClose(err) {
		if(this.connectState == ConnectStates.Disconnected)
			return;
		
		if(!this.reconnect)
			return this.updateState(ConnectStates.Disconnected, err);
		
		this.updateState(ConnectStates.Reconnecting, err);
		if(this.reconnectTimeout)
			clearTimeout(this.reconnectTimeout);
		
		this.reconnectTimeout = setTimeout(() => {
			if(this.reconnect) {
				const oldCallback = this.connectCallback;
				this.connect();
				this.connectCallback = oldCallback;
			}
			this.reconnectTimeout = null;
		}, 5000);
	}

	/**
	 * Handle incoming IRC commands from Bancho
	 * @param {string} command 
	 * @private
	 */
	handleIrcCommand(command) {
		const splits = command.split(" ");

		if(ignoredSplits.indexOf(splits[1]) != -1)
			return;

		if(splits[0] == "PING") {
			splits.shift();
			this.send("PONG "+splits.join(" "));
		}
		else if(IrcCommands[splits[1]])
			(IrcCommands[splits[1]]).handleCommand(this, splits[1], splits);
		/*else
			console.log("Unknown command", command);*/
	}

	/**
	 * Get a BanchoUser instance for the specified username
	 * 
	 * @param {string} username 
	 * @returns {BanchoUser}
	 */
	getUser(username) {
		username = username.replace(/ /g, "_").split("\n")[0].substring(0, 28);
		if(this.users[username.toLowerCase()])
			return this.users[username.toLowerCase()];
		else
			return (this.users[username.toLowerCase()] = new BanchoUser(this, username));
	}

	/**
	 * Get a BanchoUser instance for the specified user id
	 * 
	 * @param {number} userid
	 * @returns {Promise<BanchoUser>}
	 */
	getUserById(userid) {
		return new Promise((resolve, reject) => {
			if(isNaN(userid))
				reject(new Error("id needs to be a number!"));
			if(this.usersById[userid])
				resolve(this.usersById[userid]);
			else
				this.osuApi.user.get(userid, Nodesu.LookupType.id).then((apiUser) => {
					const user = this.getUser(apiUser.username);
					user.updateFromAPI(apiUser);
					resolve(apiUser);
				}, reject);
		});
	}

	/**
	 * Get a BanchoChannel instance for the specified name
	 * 
	 * @param {string} channelName 
	 * @returns {BanchoChannel|BanchoMultiplayerChannel}
	 */
	getChannel(channelName) {
		if(channelName.indexOf("#") != 0 || channelName.indexOf(",") != -1 || channelName.indexOf("") != -1)
			throw new Error("Invalid channel name!");
		if(this.channels[channelName])
			return this.channels[channelName];
		else if(channelName.indexOf("#mp_") == 0 && this.osuApi != null)
			return (this.channels[channelName] = new BanchoMultiplayerChannel(this, channelName));
		else
			return (this.channels[channelName] = new BanchoChannel(this, channelName));
	}

	/**
	 * Connects to Bancho, rejects an Error if connection fails
	 * 
	 * @method
	 * @async
	 * @return {Promise<null, Error>}
	 */
	connect() {
		return new Promise((resolve, reject) => {
			if(this.connectState == ConnectStates.Connected ||
				this.connectState == ConnectStates.Connecting)
				return reject(new Error("Already connected/connecting"));
			
			this.connectCallback = (err) => {
				if(err)
					return reject(err);
				resolve();
			};

			this.updateState(ConnectStates.Connecting);
			this.reconnect = true;
			this.initSocket();
			this.client.connect(this.port, this.host, () => {
				this.send("PASS "+this.password);
				this.send("USER "+this.username+" 0 * :"+this.username);
				this.send("NICK "+this.username);
			});
		});
	}

	/**
	 * Disconnects from Bancho
	 * 
	 * @method
	 */
	disconnect() {
		if(this.connectState == ConnectStates.Disconnected)
			return;
		
		if(this.isConnected())
			this.send("QUIT");
		else if(this.connectState == ConnectStates.Connecting)
			this.client.destroy();
		
		if(this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		this.updateState(ConnectStates.Disconnected);
		setTimeout(() => this.ignoreClose = false, 1);  // close event is apparently not fired immediately after calling destroy...	}
	}

	/**
	 * When we've just connected, execute the connect callback
	 * 
	 * @param {any} arg Arg to pass to the callback
	 * @param {boolean} [erase=true] Erase the existing callback
	 * @param {boolean} [throwIfNonexistant=false] Throw an error if the callback doesn't exist
	 * @private
	 */
	callConnectCallback(arg, erase = true, throwIfNonexistant = false) {
		if(this.connectCallback != null) {
			this.connectCallback(arg);
			if(erase)
				this.connectCallback = null;
		}
		else if(throwIfNonexistant)
			throw new Error("Inexistant connect callback!");
	}

	/**
	 * Returns the current connection state.
	 * 
	 * @returns {Symbol} Current connection state. See ConnectStates
	 */
	getConnectState() {
		return this.connectState;
	}
	
	/**
	 * Returns true if the connectState is Connected, otherwise false.
	 * 
	 * @returns {boolean}
	 */
	isConnected() {
		return (this.connectState == ConnectStates.Connected);
	}

	/**
	 * Returns true if the connectState is Disconnected, otherwise false.
	 * 
	 * @returns {boolean}
	 */
	isDisconnected() {
		return (this.connectState == ConnectStates.Disconnected);
	}
}

module.exports = BanchoClient;