/* iTunes JavaScript module for CommandFusion
=========================================================================

AUTHOR: Florent Pillet, CommandFusion
CONTACT: support@commandfusion.com
URL: www.commandfusion.com/scripting/examples/iTunes
VERSION: v0.1
LAST MODIFIED: 7 may 2011

=========================================================================
HELP:

To use this script, please complete the following steps:
1. Add this script to your project properties.
2. Create a system in system manager named 'iTunesPairingServer':
   - Set the IP address to "localhost"
   - Check "Accept incoming connections"
   - Set the port to a port of your choosing for this system (will accept connections on this port)
   - Don't set the EOM
3. Add a single feedback item named 'Pairing request' with regex as follows: GET /pair\?(.*)\n
   - You do not need to add anything else to the feedback item, just the name and regex.
4. Add a Persistent Global Token to the project, named "iTunesPairedServices"

NOTE: if you don't follow exactly the instructions above, this module will not work!
=========================================================================
*/
var iTunesGlobals = {
	daapContainerTypes: "msrv mccr mdcl mlog mupd mlcl mlit apso aply"
};

/* ---------------------------------------------------------------------
 * An iTunesInstance object is an object that talks to one iTunes server
 * ---------------------------------------------------------------------
 */
var iTunesInstance = function(instance) {
	//
	// Returned object with public variables and functions
	//
	var self = {
		// Public configuration
		login: "",							// login and password information you can set
		password: "",						// if iTunes needs it

		// Publicly useful variables
		remotePaired: false,				// set to true if we are paired with this instance for remote control
		connected: false,					// set to true once we are logged in and can talk
		needsPassword: false,				// set to true if this instance requires a password for login

		service: instance					// the actual iTunes service description
	};

	//
	// Private functions
	//
	function getAddress() {
		// Get the actual address of the iTunes instance, depending on whether
		// we are on IPv4 or IPv6 network.
		var addrs = self.service.addresses;
		var i, len = addrs.length;
		if (CF.ipv4address.length > 0) {
			for (i=0; i < len; i++) {
				if (addrs[i].indexOf(":") == -1) {
					return addrs[i];
				}
			}
		}
		for (i=0; i < len; i++) {
			if (addrs[i].charAt(0) == "[") {
				return addrs[i];
			}
		}
	}

	function description() {
		var name = self.service["Machine Name"];
		if (name === undefined) {
			name = "";
		}
		return "<iTunesInstance " + name + " @ " + getAddress() + ">";
	}

	function decodeDAAP(str) {
		// Decode a DAAP packet into a full-fledged object.
		if (str.length < 8) {
			return null;
		}
		var obj = {};
		var prop = str.substr(0, 4);
		var propLen = (str.charCodeAt(4) << 24) | (str.charCodeAt(5) << 16) | (str.charCodeAt(6) << 8) | str.charCodeAt(7);
		if (iTunesGlobals.daapContainerTypes.indexOf(prop) == -1) {
			// not a container: return value contents
			obj[prop] = str.substr(8);
		} else {
			// container: decode subcontents
			var cont = decodeDAAP(str.substr(8));
			if (cont !== null) {
				obj[prop] = cont;
			}
		}
		return obj;
	}

	function sendDAAPRequest(command, params, callback) {
		// Send a request to iTunes, wait for result, decode DAAP object and pass it to callback
		// Callback receives:
		// (returned DAAP object, error message)
		// If no error, error message is null

		// Build the URL
		var url = "daap://" + getAddress() + "/" + command;
		var args = [];
		if (params.length > 0) {
			for (var prop in params) {
				if (params.hasOwnProperty(prop)) {
					var v = params[prop];
					var t = typeof(v);
					if (t == "string" || t=="number" || t=="bool") {
						args.push(prop+"="+t.toString());
					}
				}
			}
			if (args.length > 0) {
				url += "?" + encodeURIComponent(args.join("&"));
			}
		}

		// Send the request
		var that = this;
		CF.request(url, function(status, headers, body) {
			if (status == 200) {
				// Call the callback with the returned object
				callback.apply(null, [that.decodeDAAP(body), null]);
			} else {
				// Call the callback with an error
				callback.apply(null, [null, "Request failed with status " + status]);
			}
		});
	}

	/* -------------------------------
	 * Public functions
	 * -------------------------------
	 */
	self.connect = function() {
		// First get server info
		sendDAAPRequest("server-info", [], function(result, error) {
			if (error !== null) {
				if (CF.debug) {
					CF.log("Trying to get server info from " + description());
					CF.log("Error = " + error);
				}
			} else {
				CF.log("Received server-info:");
				CF.logObject(result);
			}
		});
	};
	
	return self;
};

/* -------------------------------------------------------------------------------------------
 * The iTunes global object is used to pair with iTunes servers and discover running instances
 * -------------------------------------------------------------------------------------------
 */
var iTunes = {
	/* -------------------------------
	 * iTunes object variables
	 * -------------------------------
	 */
	// Pairing
	publishing: false,
	pairingName: "iViewer Remote",		// the remote name that shows up in iTunes
	pairingGUID: undefined,				// the string we use as the unique pairing GUID (automatically generated from device UDID)
	pairingCode: "0000",				// the pairing code you want to use. Set this
	pairingSystem: "",					// the local System we use to receive pairing requests
	pairingSystemPort: 0,				// the port on which we accept pairing requests
	pairedServices: [],					// the names (iTunes UIDs) of the services we are paired with
	activePairedServices: [],			// the list of currently active (on the network) iTunes instances we are paired with
	activeServers: [],				// the current active iTunes instances on the network (an array on iTunesInstance objects)

	/* -------------------------------
	 * SETUP
	 * -------------------------------
	 */
	setup: function() {
		// Prepare this device's pairing GUID based on the device UDID
		// returned by the OS. The GUID needs to be 32 chars (ASCII hex representation of 16 bytes)
		this.pairingGUID = CF.device.uuid.replace(/- /, "").toUpperCase();
		while (this.pairingGUID.length < 16) {
			this.pairingGUID += "0";
		}
		this.pairingGUID = this.pairingGUID.substr(0,16);

		// Locate the iTunesPairingServer system, use its port
		for (var name in CF.systems) {
			if (CF.systems.hasOwnProperty(name) && name == "iTunesPairingServer") {
				this.pairingSystem = name;
				this.pairingSystemPort = CF.systems[name].localPort;
				CF.log("pairingSystemPort="+this.pairingSystemPort);
				CF.watch(CF.FeedbackMatchedEvent, name, "Pairing request", this.processPairingRequest);
			}
		}
		if (this.pairingSystemPort === undefined) {
			CF.log("You need to have a TCP server system named 'iTunesPairingServer' defined in your GUI.");
		} else {
			// Get the global token that holds the already-paired service name, if any
			var that = this;
			CF.getJoin(CF.GlobalTokensJoin, function(j, v, t) {
				// Check whether the global token is defined in the GUI
				if (t["iTunesPairedServices"] !== undefined) {
					// Load the list of known paired services
					that.pairedServices = t["iTunesPairedServices"].split("|");

					// We can now start accepting further pairing requests.
					that.startAcceptingPairingRequests();
					CF.log("iTunes setup complete - pairing GUI=" + that.pairingGUID + ", code=" + that.pairingCode);
				} else {
					CF.log("You need to define a persisting global token named iTunesPairedServices for the iTunes module to use.");
				}
			});
		}
		
		// setup is executed exactly once, we can now delete this function to save memory
		delete this.setup;
	},
	
	//
	// DAAP packet support
	//
	encodeDAAP: function(obj) {
		// Deep encode an object to a DAAP binary struct. All properties of the object
		// MUST be four-char strings
		var s = "";
		function encodeInt32(l) {
			// Helper function to encode an int32 into a string of bytes, big-endian
			return String.fromCharCode((l >> 24) & 0xff, (l >> 16) & 0xff, (l >> 8) & 0xff, l & 0xff);
		}
		for (var prop in obj) {
			if (obj.hasOwnProperty(prop)) {
				var v = obj[prop];
				var objStr = (typeof(v) == "object") ? this.encodeDAAP(v) : v.toString();
				s += prop + encodeInt32(objStr.length) + objStr;
			}
		}
		return s;
	},

	//
	// PAIRING WITH ITUNES
	//
	startAcceptingPairingRequests: function(pairingCode) {
		// Start publishing a Bonjour service on the network for remote pairing with iTunes
		// The pairingCode parameter, if provided, is a four digit string that is the code
		// user must enter in iTunes to validate pairing with this device
		CF.log("startAcceptingPairingRequests");
		if (!this.publishing) {
			// Remember the pairing code, we'll use it for validation
			if (pairingCode !== undefined && typeof(pairingCode) == "string" && pairingCode.length === 4) {
				this.pairingCode = pairingCode;
			}
			
			// Prepare the TXT record and publish (all components must be strings)
			var txtData = {
				"DvNm": this.pairingName,
				"RemV": "10000",
				"DvTy": CF.device.model,
				"RemN": "Remote",
				"txtvers": "1",
				"Pair": this.pairingGUID
			};
			if (CF.debug) {
				CF.log("Start advertising iViewer Remote with pairing ID " + this.pairingGUID);
			}
			CF.startPublishing("_touch-remote._tcp", "", this.pairingSystemPort, txtData, this.remotePairingPublishResult);
			this.publishing = true;
		}
	},

	remotePairingPublishResult: function(name, type, port, published, error) {
		// This function is called as a result of CF.startPublishing()
		if (!published) {
			if (CF.debug) {
				CF.log("Failed publishing service for iTunes pairing, error: " + error);
			}
			iTunes.publishing = false;
		} else if (CF.debug) {
			CF.log("Ready for pairing with name="+name+", port="+port);
		}
	},

	processPairingRequest: function(feedbackItem, matchedStr) {
		if (CF.debug) {
			CF.log("Received pairing request: " + matchedStr);
		}
		var matches = matchedStr.match(/GET \/pair\?pairingcode=([0-9A-F]{32})&servicename=([0-9A-F]{16})/);
		if (matches.length !== 0) {
			// Validate the pairing hash
			var hash = matches[1];
			var validationStr = iTunes.pairingGUID;
			for (var i=0; i < iTunes.pairingCode.length; i++) {
				validationStr += iTunes.pairingCode.charAt(i) + "\x00";
			}
			CF.hash(CF.Hash_MD5, validationStr, function(validationHash) {
				if (validationHash == hash) {
					// The pairing code is valid, remember this pairing in the
					// global token and send confirmation
					iTunes.pairedServiceName = matches[2];
					var reply = {
						"cmpa": {
							"cmnm": iTunes.pairingName,
							"cmty": CF.device.model,
							"cmpg": "00000001"
						}
					};
					// Send the response to iTunes
					var response = iTunes.encodeDAAP(reply);
					CF.send(iTunes.pairingSystem, "HTTP/1.1 200 OK\r\nContent-Length: "+response.length.toString()+"\r\n\r\n" + response);
					
					// Remember the paired service in our global token
					iTunes.pairedServices.push(matches[2]);
					CF.setToken(CF.GlobalTokensJoin, "iTunesPairedServices", iTunes.pairedServices.join("|"));
				} else {
					CF.send(iTunes.pairingSystem, "HTTP/1.1 401 Unauthorized\r\n\r\n");
				}
			});
		} else {
			CF.send(iTunes.pairingSystem, "HTTP/1.1 400 Bad Request\r\n\r\n");
		}
	},

	//
	// FINDING THE LIST OF ITUNES SERVERS ON THE NETWORK
	//
	startNetworkLookup: function(callback) {
		// Call this function once to start browsing for live instances of iTunes on the network
		iTunes.activeServers = [];
		iTunes.activePairedServices = [];
		CF.startLookup("_daap._tcp.", "", function(added, removed, error) {
			function IDForService(service) {
				var serviceID = service.data["MID"];
				if (serviceID !== undefined) {
					var matches = serviceID.match(/[0-9A-F]{16}/);
					if (matches.length > 0) {
						return matches[0];
					}
				}
				return null;
			}

			if (error !== null) {
				!CF.debug || CF.log(error);
				return;
			}
			
			// add new services to the list of live iTunes instances,
			// and check whether this is a known paired service -- in this
			// case, also add it to the list of active paired services
			var i,len,service;
			for (i=0, len=added.length; i < len; i++) {
				service = added[i];
				iTunes.activeServers.push(service);
				var id = IDForService(service);
				if (id !== null) {
					var known = iTunes.pairedServices.indexOf(id);
					if (known != -1) {
						iTunes.activePairedServices.push(id);
					}
				}
			}

			// remove disappearing services from the list
			for (i=0, len=removed.length; i < len; i++) {
				service = removed[i];
				// remove service from active iTunes instances
				for (var j=0, lj=iTunes.activeServers.length; j < lj; j++) {
					if (iTunes.activeServers[j].name == service.name) {
						iTunes.activeServers.splice(j);
						break;
					}
				}
			}

			// if we were given a callback, also pass added and removed services
			// to the callback
			if (callback !== undefined) {
				callback.apply(null, [added, removed]);
			}
		});
	},

	stopNetworkLookup: function() {
		// Call this function to stop updating the list of iTunes instances on the network
		CF.stopLookup(".daap.tcp.", "");
	}
};

// Add the module to the scripting environment's modules list
CF.modules.push({name: "iTunes", object:iTunes, setup:iTunes.setup});
