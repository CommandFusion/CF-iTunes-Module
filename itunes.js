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
	daapContainerTypes: "msrv mccr mdcl mlog mupd mlcl mlit apso aply cmst casp"
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

		service: instance,					// the actual iTunes service description
		sessionID: "",
		songStatus: [],
		revision: 1
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
	
	function decodeDAAP(str){
		
		var localObj=[];
		
		if(str.length < 8) {
			return null;
		}
		obj = [];
		
	
		var tempobj = {};
		var prop = str.substr(0, 4);
		var propLen = (str.charCodeAt(4) << 24) | (str.charCodeAt(5) << 16) | (str.charCodeAt(6) << 8) | str.charCodeAt(7);

		var data = str.substr(8, propLen);
	
		var rem = str.substr(8+propLen);
	
		if(iTunesGlobals.daapContainerTypes.indexOf(prop) !== -1) {
			localObj.push(decodeDAAP(data));
			return localObj;
		} else {
			tempobj[prop] = data;
			while (rem.length >= 8) {
				
				var temprem = rem;
				
				prop = rem.substr(0,4);
				propLen = (rem.charCodeAt(4) << 24) | (rem.charCodeAt(5) << 16) | (rem.charCodeAt(6) << 8) | rem.charCodeAt(7);
				data = rem.substr(8, propLen);
				rem = rem.substr(8+propLen);
				
				if(iTunesGlobals.daapContainerTypes.indexOf(prop) !== -1) {
					localObj.push(decodeDAAP(data));
				} else {
					tempobj[prop] = data;
				}
			}
			localObj.push(tempobj);
			
			
			return localObj;
		}
	}
		
	


	function sendDAAPRequest(command, params, callback) {
		// Send a request to iTunes, wait for result, decode DAAP object and pass it to callback
		// Callback receives:
		// (returned DAAP object, error message)
		// If no error, error message is null

		// Build the URL
		var url = "http://" + getAddress() + ":3689/" + command;
		var args = [];
		if (params.length > 0) {
			for (var prop in params) {
				if (params.hasOwnProperty(prop)) {
					var v = params[prop];
					var t = typeof(v);
					if (t == "string" || t=="number" || t=="bool") {
						args.push(v.toString());
					}
				}
			}
			if (args.length > 0) {
				url += "?" + args.join("&");
			}
		}

		// Send the request
		var that = this;
		CF.request(url, "GET",
					{"Client-DAAP-Version": "3.10", 
					"Accept-Encoding": "gzip",
					"Accept": "*/*",
					"User-Agent": "Remote",
					"Viewer-Only-Client": "1"},
					function(status, headers, body) {
			if (status == 200 || status == 204 ) {
				// Call the callback with the returned object
				callback.apply(null, [decodeDAAP(body), null]);
			} else {
				// Call the callback with an error
				callback.apply(null, [null, "Request failed with status " + status]);
				if (status == -1){
					//when timing out having to log in again :/
					self.revision=1;
					itunesLogin();
				}
				
				
			}
		});
	}

	function itunesLogin() {
	
		var pairingrequest = "pairing-guid=0x" + iTunes.pairingGUID; 
		sendDAAPRequest("login",[pairingrequest], function(result, error) {
			if (error !== null) {
				if (CF.debug) {
					CF.log("Trying to get login info from " + description());
					CF.log("Error = " + error);
				}
			} else {
				CF.log("Login session info:");
				CF.logObject(result);
				
				//Takes a DAAP packet obj and then extracts the SessionID
				var session = result[0][0]["mlid"];
				var intSession = ((session.charCodeAt(0) << 24) | (session.charCodeAt(1) << 16) | (session.charCodeAt(2) << 8) | session.charCodeAt(3));
				self.sessionID = intSession;
				CF.log("Session ID = " + intSession);
				//starts polling status
				self.status(gui.joinStart);
			}
		});
	
	}
	
	function getSpeakers() {
	//get the attached speakers option
		var sessionParam = "session-id=" + self.sessionID;
		
		sendDAAPRequest("getspeakers", [sessionParam], function(result, error) {
			if (error !== null) {
				if (CF.debug) {
					CF.log("Trying to get server info from " + description());
					CF.log("Error = " + error);
				}
			} else {
				CF.log("Received speaker info:");
				CF.logObject(result);
			}
		});
	
	}
	
	/* -------------------------------
	 * Public functions
	 * -------------------------------
	 */
	self.connect = function() {
		//First get server info
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
		
		
		//Login into server
		itunesLogin();
	};
	

	
	
	self.status = function(joinStart) {
	//grabs the status also gets speakers 
		var sessionParam = "session-id=" + self.sessionID;
	
		sendDAAPRequest("ctrl-int/1/playstatusupdate", ["revision-number=" + self.revision, "daap-no-disconnect=1", sessionParam], function(result,error) {
					if (error !== null) {
						if (CF.debug) {
							CF.log("Trying to get playing info from " + description());
							CF.log("Error = " + error);
						}
					} else {
						CF.log("Received playing info");
						//CF.logObject(result);
						
						//package up data for return
						var status = {};
						status["artist"] = result[0][0]["cana"];
						status["song"] = result[0][0]["cann"];
						status["album"] = result[0][0]["canl"];
						
						if(result[0][0]["caps"].charCodeAt(0) == 3) {
							status["playing"] = 0;
						}else if(result[0][0]["caps"].charCodeAt(0) == 4) {
							status["playing"] = 1;
						}
						
						self.revision = ((result[0][0]["cmsr"].charCodeAt(0) << 24) | (result[0][0]["cmsr"].charCodeAt(1) << 16) | (result[0][0]["cmsr"].charCodeAt(2) << 8) | (result[0][0]["cmsr"].charCodeAt(3)));
						self.currentStatus = status;
						
						//get artwork
						var url = "http://" + getAddress() + ":3689/" + "ctrl-int/1/nowplayingartwork?mw=320&mh=320&session-id=" + self.sessionID;
						var artJoin = "s" + (parseInt(joinStart)+1);
						
						CF.setToken(artJoin, "HTTP:Client-DAAP-Version", 3.10);
						CF.setToken(artJoin, "HTTP:Viewer-Only-Client", 1);
		
						//gets speakers
						getSpeakers();
						
						//info to data
						CF.setJoins([
							{ join:"s"+joinStart, value:self.currentStatus["artist"] + " - " + self.currentStatus["song"]},
							{ join:"d"+joinStart, value:self.currentStatus["playing"]},
							{ join:artJoin, value:url}
						]);	
						self.status(joinStart);
						
					}
					
				});
				
				
				
		
	}
	
	self.action = function(cmd){
		var sessionParam = "session-id=" + self.sessionID;
	
	
		switch(cmd){
		
			case "playPause":
				sendDAAPRequest("ctrl-int/1/playpause", [sessionParam], function(result,error) {
					if (error !== null) {
						if (CF.debug) {
							CF.log("Trying to pause/play from " + description());
							CF.log("Error = " + error);
						}
					} else {
						CF.log("paused played" + description());
						CF.logObject(result);
					}
			
				});
				break;
				
			case "next":
				sendDAAPRequest("ctrl-int/1/nextitem", [sessionParam], function(result,error) {
					if (error !== null) {
						if (CF.debug) {
							CF.log("Trying to nextitem from " + description());
							CF.log("Error = " + error);
						}
					} else {
						CF.log("nextitem " + description());
						CF.logObject(result);
					}
			
				});
				break;
				
			case "prev":
				sendDAAPRequest("ctrl-int/1/previtem", [sessionParam], function(result,error) {
					if (error !== null) {
						if (CF.debug) {
							CF.log("Trying to previtem from " + description());
							CF.log("Error = " + error);
						}
					} else {
						CF.log("previtem " + description());
						CF.logObject(result);
					}
			
				});
				break;
				
			default:
				CF.log("Incorrect Command");
		}
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
	pairingName: "iViewer",				// the remote name that shows up in iTunes (we add the actual device name to this name)
	pairingGUID: undefined,				// the string we use as the unique pairing GUID (automatically generated from device UDID)
	pairingCode: "0000",				// the pairing code you want to use. Set this
	pairingSystem: "",					// the local System we use to receive pairing requests
	pairingSystemPort: 0,				// the port on which we accept pairing requests
	pairedServices: [],					// the names (iTunes UIDs) of the services we are paired with
	activePairedServices: [],			// the list of currently active (on the network) iTunes instances we are paired with
	activeServers: [],				// the current active iTunes instances on the network (an array on iTunesInstance objects)
	lookupActive: false,

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
				var savedPairings = t["iTunesPairedServices"];
				if (savedPairings !== undefined) {
					if (savedPairings.length !== 0) {
						// Load the list of known paired services
						that.pairedServices = savedPairings.split("|");
						CF.log("iTunes setup complete - pairing GUID=" + that.pairingGUID + ", code=" + that.pairingCode);
						if (that.pairedServices.length !== 0) {
							CF.log("Known paired services:");
							CF.logObject(that.pairedServices);
						}
					} else {
						CF.log("No saved paired services");
					}

					// We can now start accepting further pairing requests.
					that.startAcceptingPairingRequests();
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
			
			var publishedName = this.pairingName + " (" + CF.device.name + ")";
			// Prepare the TXT record and publish (all components must be strings)
			var txtData = {
				"DvNm": publishedName,
				"DvTy": CF.device.model,
				"Pair": this.pairingGUID,
				"RemV": "10000",
				"RemN": "Remote",
				"txtvers": "1"
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
			CF.log("Verifiying validation hash");
			CF.hash(CF.Hash_MD5, validationStr, function(validationHash) {
				if (validationHash == hash) {
					// The pairing code is valid, remember this pairing in the
					// global token and send confirmation
					CF.log("Hash is valid, pairing complete, sending pairing response");
					iTunes.pairedServiceName = matches[2];
					
					// Prepare the pairing valid response. Our pairing GUID must be stuffed as a binary string
					var binaryGUID = "";
					for (var i=0; i < 8; i++) {
						binaryGUID += String.fromCharCode(parseInt(iTunes.pairingGUID.substr(2*i, 2), 16));
					}
					var reply = {
						"cmpa": {
							"cmnm": this.pairingName + " (" + CF.device.name + ")",
							"cmty": CF.device.model,
							"cmpg": binaryGUID
						}
					};
					
					// Send the response to iTunes
					var response = iTunes.encodeDAAP(reply);
					CF.send(iTunes.pairingSystem, "HTTP/1.1 200 OK\r\nContent-Length: "+response.length.toString()+"\r\n\r\n" + response);
					
					// Remember the paired service in our global token
					iTunes.pairedServices.push(matches[2]);
					CF.setToken(CF.GlobalTokensJoin, "iTunesPairedServices", iTunes.pairedServices.join("|"));
				} else {
					CF.log("Hash is invalid, denying pairing");
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
		CF.log("Starting iTunes network lookup");
		if (this.lookupActive) {
			CF.log("-> a lookup is already active");
			return;
		}
		this.lookupActive = true;
		this.activeServers = [];
		this.activePairedServices = [];
		CF.startLookup("_touch-able._tcp.", "", function(added, removed, error) {
			function IDForService(service) {
				var serviceID = service.name;
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
				service.displayName = service.data["CtlN"];
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
				service.displayName = service.data["CtlN"];
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
		CF.stopLookup(".touch-able.tcp.", "");
		this.lookupActive = false;
	}
};

// Add the module to the scripting environment's modules list
CF.modules.push({name: "iTunes", object:iTunes, setup:iTunes.setup});
