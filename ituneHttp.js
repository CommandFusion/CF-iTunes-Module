function LOG_ITUNEHTTP() {
	if (CF.debug) {
		//Logs the iTunesHttp
		var s = "ituneHttp: ";
		for (var i=0; i < arguments.length; i++) {
			s += arguments[i].toString();
		}
		CF.log(s);
	}
};


//The function for the iTunesHttp, it handles send http request and also parses the http packet back
var ituneHttp = function(systemName, feedbackName, ip) {
	
	
	//global settings for the iTuneshttp function
	var self = {
		systemIP: ""
	};
	
	//Crafts the http request for the status message, keeps the connection open as the normal http request kills the connection
	self.sendHTTP = function(Rev, session) {
		//the get request for the packet
		var request = "/ctrl-int/1/playstatusupdate";
		//setting the params for the packet 
		var param = "?revision-number=" + Rev + "&daap-no-disconnect=1&session-id="+session;
		
		//All the headers
		var host = "Host:" + ip + ":3689" +"\x0D\x0A";
		var userAgent = "User-Agent: Remote" + "\x0D\x0A";
		var clientDaap = "Client-Daap-Version:3.10" + "\x0D\x0A";
		var accept = "Accept:*/*" + "\x0D\x0A";
		var viewer = "Viewer-Only-Client:1" + "\x0D\x0A";
		//var acceptEnc = "Accept-Encoding: gzip" + "\x0D\x0A";
		var connection = "Connection: keep-alive" + "\x0D\x0A";
		
		
		//crafting packet and sending it
		var httpPacket = "GET " +request + param + " HTTP/1.1" + "\x0D\x0A" + host + userAgent + clientDaap + accept + viewer + connection + "\x0D\x0A";
		CF.send("ituneHttp", httpPacket);
	};
	
	
	//decode incoming packets
	self.onIncomingData =function(theSystem, matchedString){
		//split the strings
		var lines = matchedString.split("\r\n");
		LOG_ITUNEHTTP(lines);
		
		//cycle though the lines and return the daap packet to be decoded 
		for(var i = 0; i < lines.length; i++){
			if(lines[i].substr(0,4) == "cmst"){
				gui.server.statusFeedback(lines[i]);
				return;
			}
		}
	
	};
	
	//sets the ip address dynamically  
	CF.setSystemProperties("ituneHttp", {
		address: ip,
		port: 3689 
	});
	self.systemIP = ip;
	
	//sets up the watch function for the feedback
	CF.watch(CF.FeedbackMatchedEvent, systemName, feedbackName, self.onIncomingData);
	
	return self;
};