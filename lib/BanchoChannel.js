const EventEmitter = require("events").EventEmitter;
const OutgoingBanchoMessage = require("./OutgoingBanchoMessage.js");

/**
 * Represents a discussion channel (not including PMs)
 * 
 * @prop {string} name Channel name as it is referred to on IRC (including #)
 * @prop {string} topic
 * @prop {boolean} joined Whether we've joined the channel or not
 * @prop {BanchoChannelMember[]} channelMembers Members of the channel, referenced by their name
 * @extends EventEmitter
 */
class BanchoChannel extends EventEmitter {
	/**
	 * Creates an instance of BanchoChannel.
	 * @param {BanchoClient} banchojs bancho.js client
	 * @param {string} name Channel name as it is referred to on IRC (including #)
	 */
	constructor(banchojs, name) {
		super();
		this.banchojs = banchojs;
		this.name = name;
		this.topic = "";
		this.joined = false;
		this.joinCallback = null;
		this.partCallback = null;
		this.channelMembers = {};
		this.listenersInitialized = false;
	}

	on() {
		if(!this.listenersInitialized) {
			this.banchojs.on("CM", (msg) => {
				if(msg.channel == this)
					/**
					 * Emitted when a message is received in a BanchoChannel
					 * @event BanchoChannel#message
					 * @type {ChannelMessage}
					 */
					this.emit("message", msg);
			});
			this.banchojs.on("JOIN", (member) => {
				if(member.channel == this)
					/**
					 * Emitted when someone joins this channel
					 * @event BanchoChannel#JOIN
					 * @type {BanchoChannelMember}
					 */
					this.emit("JOIN", member);
			});
			this.banchojs.on("PART", (member) => {
				if(member.channel == this)
					/**
					 * Emitted when someone leaves this channel
					 * @event BanchoChannel#PART
					 * @type {BanchoChannelMember}
					 */
					this.emit("PART", member);
			});
			this.listenersInitialized = true;
		}
		super.on.apply(this, arguments);
	}

	/**
	 * Sends a message to this channel
	 * 
	 * @throws {Error} If we're offline
	 * @param {string} message
	 * @returns {Promise<null>} Resolves when message is sent (rate-limiting)
	 */
	sendMessage(message) {
		return (new OutgoingBanchoMessage(this.banchojs, this, message)).send();
	}

	/**
	 * Join the channel
	 * 
	 * @returns {Promise<null>}
	 */
	join() {
		return this._joinOrPart("JOIN", "joinCallback");
	}

	/**
	 * Leave the channel
	 * 
	 * @returns {Promise<null>}
	 */
	leave() {
		return this._joinOrPart("PART", "partCallback");
	}

	/**
	 * Sub-function for join/leave calls
	 * 
	 * @private
	 * @param {string} action 
	 * @param {*} callbackProp 
	 */
	_joinOrPart(action, callbackProp) {
		if(action != "JOIN" && action != "PART")
			throw new Error("wrong action dumbass");
		if(this[callbackProp] != null)
			return this[callbackProp];
		return new Promise((resolve, reject) => {
			this.banchojs.send(action+" "+this.name);
			this[callbackProp] = (err) => {
				if(!err)
					resolve();
				else
					reject(err);
				this[callbackProp] = null;
			};
		});
	}
}

module.exports = BanchoChannel;