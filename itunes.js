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
String.prototype.lpad = function(padString, length) {
	var str = this;
    while (str.length < length)
        str = padString + str;
    return str;
}

var iTunesGlobals = {
	daapContainerTypes: "msrv mccr mdcl mlog mupd mlcl mlit apso aply cmst casp cmgt avdb agar agal adbs"
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
		revision: 1,
		dbid: "",
		
		
		//
		ituneHttp: ""
	};

	
	//
	// Private functions
	//
	function log(s) {
		// generic logging function that checks whether CF.debug is currently turned on.
		// if not, we won't log, otherwise concatenate all arguments in a single string
		// and log it.
		// The reason why we choose to concatenate here and not when calling log() is to
		// avoid unnecessary string operations when CF.debug is turned off.
		if (CF.debug || 1) {
			var msg = s;
			for (var i=1; i < arguments.length; i++) {
				var arg = arguments[i];
				if (arg === undefined)
					msg += "(undefined)";
				else if (arg === null)
					msg += "(null)";
				else
					msg += arg.toString();
			}
			CF.log(msg);
		}
	}
	
	function logObject(o) {
		if (CF.debug) {
			CF.logObject(o);
		}
	}
	
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
		var localObj=[];
		
		if (str == null || str.length < 8) {
			return null;
		}
		obj = [];
		var tempobj = {};
		var prop, propLen, data, rem;
			
		do {
			prop = str.substr(0, 4);
			propLen = (str.charCodeAt(4) << 24) | (str.charCodeAt(5) << 16) | (str.charCodeAt(6) << 8) | str.charCodeAt(7);
			data = str.substr(8, propLen);
			rem =  str.substr(8+propLen);
			if (iTunesGlobals.daapContainerTypes.indexOf(prop) !== -1) {
				localObj.push(decodeDAAP(data));
			} else {
				tempobj[prop] = data;
			}
			str = rem;
		} while(str.length >= 8);
		
		localObj.push(tempobj);
		return localObj;
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
		log("sendDAAPRequest: command=", command, ", url=", url);
		CF.request(url, "GET",
					{"Client-DAAP-Version": "3.10", 
					"Accept-Encoding": "gzip",
					"Accept": "*/*",
					"User-Agent": "Remote",
					"Viewer-Only-Client": "1"},
					function(status, headers, body) {
			log("-> sendDAAPRequest got status=", status);
			if (status == 200 || status == 204 ) {
				// Call the callback with the returned object
				callback.apply(null, [decodeDAAP(body), null]);
			} else {
				// Call the callback with an error
				callback.apply(null, [null, "Request failed with status " + status]);
				if (status == -1){
					// when timing out having to log in again :/
					self.revision=1;
					itunesLogin();
				}
			}
		});
	}

	function itunesLogin() {
		log("iTunesInstance.itunesLogin()");
		var pairingrequest = "pairing-guid=0x" + iTunes.pairingGUID; 
		sendDAAPRequest("login", [pairingrequest], function(result, error) {
			if (error !== null) {
				// failed login in
				log("Trying to get login info from ", description());
				log("Error = " + error);
			} else {
				// Takes a DAAP packet obj and then extracts the SessionID
				var session = result[0][0]["mlid"];
				var intSession = ((session.charCodeAt(0) << 24) | (session.charCodeAt(1) << 16) | (session.charCodeAt(2) << 8) | session.charCodeAt(3));
				self.sessionID = intSession;

				log("Login session info:");
				log("Session ID = ", intSession);
				logObject(result);

				//new instance of ituneHttp
				self.ituneHttp = new ituneHttp("ituneHttp", "daap", getAddress());
				
				
				// starts polling status
				self.status(gui.joinStart);
			}
		});
	}
	
	// encode a string to ascii-hex. Chars >255 are truncated (high byte ignored)
	function encodeToHex(str) {
		var i = 0, n = str.length, c, s = "", h = "0123456789ABCDEF";
		while (i < n) {
			c = str.charCodeAt(i++);
			s += h[(c >> 4) & 0x0f] + h[c & 0x0f];
		}
		return s;
	}

	// get the attached speakers option
	function getSpeakers() {
		log("iTunesInstance.getSpeakers()");
		var sessionParam = "session-id=" + self.sessionID;
		//clears list
		CF.listRemove("l"+gui.joinStart);
		
		sendDAAPRequest("getspeakers", [sessionParam], function(result, error) {
			if (error !== null) {
				log("Trying to get server info from ", description());
				log("Error = " + error);
			} else {
				log("Received speaker info:");
				logObject(result);

				for (var i=0, r=result[0], n=r.length-1; i < n; i++) {
					var speakerid = encodeToHex(r[i][0]["msma"]).replace(/0/g,"");
					CF.listAdd("l"+gui.joinStart, [{
						// add one item
						s1: r[i][0]["minm"],
						d2: {
							tokens: {"[id]": speakerid}
						}
					}]);
				}
			}
		});
	}
	
	//Gets the speaker Volume
	function getVolume()  {
		log("iTunesInstance.getVolume()");

		//ctrl-int/1/getproperty?properties=dmcp.volume&session-id=xxxxxxxxx
		var sessionParam = "session-id=" + self.sessionID;

		sendDAAPRequest("ctrl-int/1/getproperty", ["properties=dmcp.volume", sessionParam], function(result, error) {
			if (error !== null) {
				log("Trying to get Volume info from ", description());
				log("Error = ", error);
			} else {
				var volume = result[0][0]["cmvo"];
				volume = ((volume.charCodeAt(0) << 24) | (volume.charCodeAt(1) << 16) | (volume.charCodeAt(2) << 8) | volume.charCodeAt(3));

				log("Received Volume info: volume=", volume);
				
				//setting volume join
				var volumeJoin = "s" + (parseInt(gui.joinStart) + 3);
				
				var sliderVal = Math.max(0, Math.min((parseInt(volume) / 100) * 65535, 65535));
				CF.setJoin("a" + gui.joinStart, sliderVal);
				CF.setJoin(volumeJoin, volume +"%");
			}
		});
	}
	

	
	/* -------------------------------
	 * Public functions
	 * -------------------------------
	 */
	self.connect = function() {
		log("iTunesInstance.connect()");

		// First get server info
		sendDAAPRequest("server-info", [], function(result, error) {
			if (error !== null) {
				log("Trying to get server info from ", description());
				log("Error = ", error);
			} else {
				log("Received server-info:");
				logObject(result);

				// login into server, then get first DB
				itunesLogin();
			}
		});
	};
	
	self.selectDatabase = function(id, command, place) {
		log("iTunesInstance.selectDatabase(id=", id,", command=", command, ", place=", place, ")");

		var dbJoin = "l" + (parseInt(gui.joinStart) + 1);
		var artistJoin = "l" + (parseInt(gui.joinStart) + 2);
		var albumJoin = "l" + (parseInt(gui.joinStart) + 3);
		var songJoin = "l" + (parseInt(gui.joinStart) + 4);
		

		var sessionParam = "session-id=" + self.sessionID;
		var request = "";
		var meta ="";
		
		if (command == "0") {
			CF.listRemove(dbJoin);
			CF.listRemove(artistJoin);
			CF.listRemove(albumJoin);
			CF.listRemove(songJoin);
			
			sendDAAPRequest("databases", [meta, sessionParam], function(result, error) {
				if (error !== null) {
					log("Trying to database from " + description());
					log("Error = " + error);
				} else {
					log("Got Databases:");
					logObject(result);
					var results = result[0][0];
					if (results.length > 0) {
						for(var i = 0; i < results.length - 1; i++) {
							var newid = results[i][0]["miid"];
							newid = ((newid.charCodeAt(0) << 24) | (newid.charCodeAt(1) << 16) | (newid.charCodeAt(2) << 8) | newid.charCodeAt(3));
							CF.listAdd(dbJoin , [{
								// add one item
								s1: decodeURIComponent(escape(results[i][0]["minm"])),
								d2: {
									tokens: {"[id]": newid, "[cmd]": "1"}
								}
							}]);
						}
					}
				}
			});

		} else if (command == "1") {
			
			CF.listRemove(artistJoin);
			CF.listRemove(albumJoin);
			CF.listRemove(songJoin);
		
			self.dbid = id;
			request = "databases/" + self.dbid + "/groups";
			meta = "meta=dmap.itemname,dmap.itemid,dmap.persistentid,daap.songartist,daap.groupalbumcount&type=music&group-type=artists&sort=album&include-sort-headers=1&query=(('com.apple.itunes.mediakind:1','com.apple.itunes.mediakind:32')+'daap.songartist!:')"
			
			sendDAAPRequest(request, [meta, sessionParam], function(result, error) {
				if (error !== null) {
					log("Trying to database from ", description());
					log("Error = " + error);
				} else {
					log("Got result:");
					logObject(result);
					var results = result[0][0];
					if (results.length > 0) {
						for (var i = 0; i < results.length - 1; i++) {
							//ID for artwork and address
							var newid = results[i][0]["miid"];
							newid = ((newid.charCodeAt(0) << 24) | (newid.charCodeAt(1) << 16) | (newid.charCodeAt(2) << 8) | newid.charCodeAt(3));
							var url = "http://" + getAddress() + ":3689/databases/" + self.dbid + "/groups/" + newid + "/extra_data/artwork?mw=43&mh=43&group-type=artists&" + sessionParam; 
							
							
							if (newid != null) {
								CF.listAdd(artistJoin , [{
									// add one item
									s1: decodeURIComponent(escape(results[i][0]["minm"])),
									d2: {
										tokens: {"[id]": decodeURIComponent(escape(results[i][0]["minm"])), "[cmd]": "2"}
									},
									//setting artwork tokens and value
									s10: {
										tokens: {"HTTP:Client-DAAP-Version": 3.10, "HTTP:Viewer-Only-Client": 1},
										value: url
									}
								}]);
							}
						}
					}
				}
			});
			
		} else if (command == "2") {
			
			CF.listRemove(albumJoin);
			CF.listRemove(songJoin);
			
			request = "databases/" + self.dbid + "/groups"
			meta = "meta=dmap.itemname,dmap.itemid,dmap.persistentid,daap.songalbumid,daap.songartist,daap.songdatereleased,dmap.itemcount,daap.songtime,dmap.persistentid&type=music&group-type=albums&sort=album&include-sort-headers=1&query=(('daap.songartist:" + id + "','daap.songalbumartist:"+ id +"')+('com.apple.itunes.mediakind:1','com.apple.itunes.mediakind:32')+'daap.songalbum!:')"
			meta = encodeURI(meta);
			
			sendDAAPRequest(request, [meta, sessionParam], function(result, error) {
				if (error !== null) {
					log("Trying to database from ", description());
					log("Error = " + error);
				} else {
					log("Got result:");
					logObject(result);
					var results = result[0][0];
					if (results.length > 0) {
						for (var i = 0; i < results.length - 1; i++) {
							//get artwork id and url
							var newid = results[i][0]["miid"];
							newid = ((newid.charCodeAt(0) << 24) | (newid.charCodeAt(1) << 16) | (newid.charCodeAt(2) << 8) | newid.charCodeAt(3));
							var url = "http://" + getAddress() + ":3689/databases/" + self.dbid + "/groups/" + newid + "/extra_data/artwork?mw=43&mh=43&group-type=albums&" + sessionParam; 
							if (newid != null) {
								CF.listAdd(albumJoin , [{
									// add one item
									s1: decodeURIComponent(escape(results[i][0]["minm"])),
									d2: {
										tokens: {"[id]": decodeURIComponent(escape(results[i][0]["minm"])), "[cmd]": "3"}
									},
									//setting artwork tokens and value
									s10: {
										tokens: {"HTTP:Client-DAAP-Version": 3.10, "HTTP:Viewer-Only-Client": 1},
										value: url
									}
								}]);
							}
						}
					}
				}
			});

		} else if (command=="3") {
			
			CF.listRemove(songJoin);
			
			request = "databases/" + self.dbid + "/items";
			meta = "meta=dmap.itemname,dmap.itemid,dmap.persistentid,daap.songartist,daap.songdatereleased,dmap.itemcount,daap.songtime,dmap.persistentid,daap.songalbumid,daap.songtracknumber&type=music&group-type=albums&sort=album&include-sort-headers=1"
			var query = "query=(('daap.songalbum:" + id + "')+('com.apple.itunes.mediakind:1','com.apple.itunes.mediakind:32'))";
			query = encodeURI(query);
			
			sendDAAPRequest(request, [meta, query, sessionParam], function(result, error) {
				if (error !== null) {
					log("Trying to database from ", description());
					log("Error = " + error);
				} else {
					log("Got result:");
					logObject(result);
					var results = result[0][0];
					if (results.length > 0) {
						for (var i = 0; i < results.length - 1; i++) {
						
							//get track number
							var trackNum = results[i][0]["astn"];
							if(trackNum.length == 2){
								trackNum = ((trackNum.charCodeAt(0) << 8) | (trackNum.charCodeAt(1)));
							}else if(trackNum.length == 4){
								trackNum = ((trackNum.charCodeAt(0) << 24) | (trackNum.charCodeAt(1) << 16) | (trackNum.charCodeAt(2) << 8) | (trackNum.charCodeAt(3))  );
							}
							newid = results[i][0]["asai"];
							//var newid = result[0][0][i][0]["mper"];
							var tempbin = "";
							var albumid = [];
							var binaryid = "";
							var temppwr = "1";
							var idtotal = "0";

							for (var a = 0; a < newid.length; a++) {
								tempbin = newid.charCodeAt(a).toString(2);
								if(a != 0) {
									tempbin = tempbin.lpad("0", 8);
								}
								binaryid = binaryid + tempbin;
							}
							
							for (var a = 0; a < binaryid.length; a++) {
								//albumid += (parseInt(binaryid[a]) * Math.pow(2, ((binaryid.length-1)-a)));
								if (a == binaryid.length-1) {
									temppwr = "1";
								} else{
									for (var b = 0; b < binaryid.length-1-a; b++) {
										temppwr = bigint_mul("2",temppwr);
									}
								}

								albumid[a] = bigint_mul(binaryid[a],temppwr)
								temppwr = "1";
							}

							for (var c = 0; c < albumid.length; c++) {
								if (albumid[c] != "0") {
									idtotal = bigint_plus(idtotal, albumid[c]);
								}
							}

							log("idtotal=", idtotal);

							if (newid != null) {
								CF.listAdd(songJoin , [{
									// add one item
									s1: decodeURIComponent(escape(results[i][0]["minm"])),
									d2: {
										tokens: {"[id]": idtotal + "z", "[cmd]": "4", "[place]": trackNum - 1 }
									}
								}]);
							}
						}
					}
				}
			});
		
		} else if (command=="4") {

			// clear cue
			request = "ctrl-int/1/cue";

			sendDAAPRequest(request, ["command=clear", sessionParam], function(result, error) {
				if (error !== null) {
					log("Trying to Play from " + description());
					log("Error = " + error);
				} else {
					log("Got Music");
					//CF.logObject(result);
					
					var cmd = "command=play&query='daap.songalbumid:" + id + "'&index=" + place + "&sort=album";
			
					sendDAAPRequest(request, [cmd, sessionParam], function(result, error) {
						if (error !== null) {
							log("Trying to Play from " + description());
							log("Error = " + error);
						} else {
							CF.log("Got Music");
							//CF.logObject(result);
					
							
						}	
					});
				}	
	
			});
			
			
		}
	};
	
	self.setVolume = function(volume) {
		log("iTunesInstance.setVolume(volume=", volume, ")")

		//set join for volume
		var volumeJoin = "s" + (parseInt(gui.joinStart)+3);
		CF.setJoin(volumeJoin, volume +"%");

		
		var sessionParam = "session-id=" + self.sessionID;
		
		//ctrl-int/1/setproperty?dmcp.volume=100.000000&session-id=xxxxxx
		sendDAAPRequest("ctrl-int/1/setproperty", ["dmcp.volume="+volume, sessionParam], function(result, error) {
			if (error !== null) {
				log("Trying to set info from " + description());
				log("Error = " + error);
			} else {
				log("Set Volume");
				logObject(result);
			}
		});
	};

	self.setSpeakers = function(id) {
		log("iTunesInstance.setSpeakers(id=",id,")");
		
		var sessionParam = "session-id=" + self.sessionID;
		
		id = (id == null || id == "") ? "0" : "0x" + id;

		sendDAAPRequest("ctrl-int/1/setspeakers", ["speaker-id="+id, sessionParam], function(result,error) {
			if (error !== null) {
				log("Trying to set speakers from ", description());
				log("Error = ", error);
			} else {
				log("set speakers", description());
				logObject(result);
			}
		});
	};

	//handles data returned from percistant connection
	self.statusFeedback = function(body) {
			//decode packet
			var result = decodeDAAP(body);
			
			var joinStart = gui.joinStart;
			
			log("Received playing info");

			//package up data for return
			var status = {};
			status["artist"] = result[0][0]["cana"];
			status["song"] = result[0][0]["cann"];
			status["album"] = result[0][0]["canl"];
				
			if (result[0][0]["caps"].charCodeAt(0) == 3) {
				status["playing"] = 0;
			} else if(result[0][0]["caps"].charCodeAt(0) == 4) {
				status["playing"] = 1;
			}

			self.revision = ((result[0][0]["cmsr"].charCodeAt(0) << 24) | (result[0][0]["cmsr"].charCodeAt(1) << 16) | (result[0][0]["cmsr"].charCodeAt(2) << 8) | (result[0][0]["cmsr"].charCodeAt(3)));
			self.currentStatus = status;
				
			//get artwork
			var url = "http://" + getAddress() + ":3689/" + "ctrl-int/1/nowplayingartwork?mw=320&mh=320&session-id=" + self.sessionID;
			var artJoin = "s" + (parseInt(joinStart)+1);
			//headers for the image
			CF.setToken(artJoin, "HTTP:Client-DAAP-Version", 3.10);
			CF.setToken(artJoin, "HTTP:Viewer-Only-Client", 1);

			//gets speakers
			getSpeakers();
				
			//get volume
			getVolume();
				
			//sets album join
			var albumJoin = "s" + (parseInt(joinStart) + 2)
				
			//info to data
			CF.setJoins([
				{ join:"s"+joinStart, value:self.currentStatus["artist"] + " - " + self.currentStatus["song"]},
				{ join:albumJoin, value:"album - " + self.currentStatus["album"]},
				{ join:"d"+joinStart, value:self.currentStatus["playing"]},
				{ join:artJoin, value:url}
			]);	
			self.ituneHttp.sendHTTP(self.revision, self.sessionID);
	
	}
	
	self.status = function(joinStart) {
		log("iTunesInstance.status(joinStart=", joinStart, ")");

		// grabs the status also gets speakers 
		var sessionParam = "session-id=" + self.sessionID;
		
		self.ituneHttp.sendHTTP(self.revision, self.sessionID);
		
	}
	
	self.action = function(cmd) {
		log("iTunesInstance.action(cmd=",cmd,")");
		
		var sessionParam = "session-id=" + self.sessionID;
	
		switch (cmd) {
			case "playPause":
				sendDAAPRequest("ctrl-int/1/playpause", [sessionParam], function(result,error) {
					if (error !== null) {
						log("Trying to pause/play from ", description());
						log("Error = ", error);
					} else {
						log("paused played" + description());
						//CF.logObject(result);
					}
				});
				break;
				
			case "next":
				sendDAAPRequest("ctrl-int/1/nextitem", [sessionParam], function(result,error) {
					if (error != null) {
						log("Trying to nextitem from ", description());
						log("Error = ", error);
					} else {
						log("nextitem ", description());
						//CF.logObject(result);
					}
				});
				break;
				
			case "prev":
				sendDAAPRequest("ctrl-int/1/previtem", [sessionParam], function(result,error) {
					if (error !== null) {
						log("Trying to previtem from ", description());
						log("Error = ", error);
					} else {
						log("previtem ", description());
						//CF.logObject(result);
					}
				});
				break;
				
			default:
				log("Incorrect Command");
				break;
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
						binaryGUID += String.fromCharCode(parseInt(iTunes.pairingGUID.substr(2*i, 2), 16) & 0xff);
					}
					var reply = {
						"cmpa": {
							"cmnm": iTunes.pairingName + " (" + CF.device.name + ")",
							"cmty": CF.device.model,
							"cmpg": binaryGUID
						}
					};
					
					// Send the response to iTunes
					var response = iTunes.encodeDAAP(reply);
					CF.send(iTunes.pairingSystem, "HTTP/1.1 200 OK\r\nContent-Length: "+ response.length + "\r\n\r\n" + response);

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
