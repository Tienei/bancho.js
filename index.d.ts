import { EventEmitter } from "events";

declare class BanchoClient extends EventEmitter {
	
	/**
	 * @param username Username of the user to connect to Bancho
	 * @param password IRC Password of the user to connect to Bancho (see https://osu.ppy.sh/p/irc)
	 * @param host Custom IRC host (for proxy-ing from a firewall for example)
	 * @param port Custom IRC port
	 */
	constructor(username: string, password: string, host?: string, port?: number)

	/**
	 * Sends a message to an user or a channel over IRC
	 * @param recipient Recipient of the message (either a channel or an username)
	 * @param message Message
	 */
	sendMessage(recipient: string, message: string): void
	
	/**
	 * Connects to Bancho, rejects an Error if connection fails
	 */
	connect(): Promise<null>
	
	/**
	 * Disconnects from Bancho
	 */
	disconnect(): void
	
	/**
	 * Join a channel, rejects an Error if joining fails or we're disconnected
	 * @param channelName Channel we want to join
	 */
	joinChannel(channelName: string): Promise<null>

	/**
	 * Leave a channel, rejects an Error if leaving fails or we're disconnected
	 * @param channelName Channel we want to leave
	 */
	leaveChannel(channelName: string): Promise<null>
	
	/**
	 * Returns the current connection state.
	 */
	getConnectState(): Symbol
	
	/**
	 * Returns true if the connectState is Connected, false otherwise.
	 */
	isConnected(): boolean
	
	/**
	 * Returns true if the connectState is Disconnected, otherwise false.
	 */
	isDisconnected(): boolean
	
	/**
	 * Registers a listener for channel messages.
	 * @param listener the callback
	 */
	on(event: "CM", listener: (message: ChannelMessage) => void): this
	
	/**
	 * Registers a listener for the successful connection events.
	 * @param listener the callback
	 */
	on(event: "connected", listener: () => void): this
	
	/**
	 * Registers a listener for the disconnection events.
	 * @param listener the callback
	 */
	on(event: "disconnected", listener: () => void): this
	
	/**
	 * Registers a listener for errors.
	 * @param listener the callback
	 */
	on(event: "error", listener: (error: Error) => void): this
	
	/**
	 * Registers a listener for when a user joins a channel.
	 * @param listener the callback
	 */
	on(event: "JOIN", listener: (data: ChannelUser) => void): this
	
	/**
	 * Registers a listener for when the client fails to enter a non-existant channel.
	 * @param listener the callback with a String value of the channel.
	 */
	on(event: "nochannel", listener: (channel: String) => void): this
	
	/**
	 * Registers a listener for when a user leaves a channel.
	 * @param listener the callback
	 */
	on(event: "PART", listener: (data: ChannelUser) => void): this
	
	/**
	 * Registers a listener for private messages.
	 * @param listener the callback
	 */
	on(event: "PM", listener: (message: PrivateMessage) => void): this
	
	/**
	 * Registers a listener for client state changes.
	 * @param listener the callback with a Symbol from ConnectStates and a possible error.
	 */
	on(event: "state", listener: (state: Symbol, error?: Error) => void): this
	
}

declare interface ConnectStateTypes {
	/** 
	 * When we're purposely disconnected from Bancho or after an auth fail 
	 */
	Disconnected: Symbol,

	/** 
	 * When we've opened the socket before any reconnection attempts and waiting for the Welcome packet 
	 */
	Connecting: Symbol,

	/** 
	 * When we've gotten disconnected, and are currently waiting before trying to reconnect 
	 */
	Reconnecting: Symbol,

	/** 
	 * When we're online! \o/ 
	 */
	Connected: Symbol
}

/**
 * Contains the different connect states: Disconnected, Connecting, Reconnecting, Connected.
 */
export const ConnectStates: ConnectStateTypes

/**
 * The base type for messages.
 */
declare interface Message {
	user: string,
	message: string
}

/**
 * The type for channel messages.
 */
declare interface ChannelMessage extends Message {
	channel: string
}

/**
 * The type for private messages.
 */
declare interface PrivateMessage extends Message {
}

/**
 * The type for a user-channel pair.
 */
declare interface ChannelUser {
	username: string,
	channel: string
}