var ituneHttp = function(systemName, feedbackName, ip) {
	
	

	var self = {
		systemIP: ""
	};
	
	//Crafts the http request
	self.sendHTTP = function(Rev, session) {
		
		var request = "/ctrl-int/1/playstatusupdate";
		var param = "?revision-number=" + Rev + "&daap-no-disconnect=1&session-id="+session;
		
		//All the headers
		var host = "Host:" + ip + ":3689" +"\x0D\x0A";
		var userAgent = "User-Agent: Remote" + "\x0D\x0A";
		var clientDaap = "Client-Daap-Version:3.10" + "\x0D\x0A";
		var accept = "Accept:*/*" + "\x0D\x0A";
		var viewer = "Viewer-Only-Client:1" + "\x0D\x0A";
		var accept = "Accept-Encoding: gzip" + "\x0D\x0A";
		var connection = "Connection: keep-alive" + "\x0D\x0A";
		
		var httpPacket = "GET " +request + param + "HTTP/1.1" + "\x0D\x0A" + host + userAgent + clientDaap + accept + viewer + accept + connection + "\x0D\x0A";
		
		CF.send("ituneHttp", httpPacket);
	}
	
	//sets the ip address
	CF.setSystemProperties("ituneHttp", {
		address: ip,
		port: 3689 
	});
	self.systemIP = ip;
	
	return self;
};